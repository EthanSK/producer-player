/**
 * v3.189.0 — Save-copy support for per-song project files.
 *
 * Lets the renderer duplicate a song's linked project file (e.g. an
 * Ableton `.als`) next to the original with the next version number
 * appended. Users want this for checkpointing the project alongside
 * each exported audio version: `barber smith.als` ⇒ `barber smith v48.als`.
 *
 * Pure logic lives here so it can be unit-tested without spinning up
 * Electron. The handler in `main.ts` injects a thin filesystem adapter.
 */

import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Splits a basename into `{ stem, extension }` where `extension`
 * includes the leading dot (e.g. `.als`) or is an empty string. Only
 * the *last* `.<ext>` is treated as the extension — so `foo.bar.als`
 * splits to `{ stem: 'foo.bar', extension: '.als' }`.
 */
export function splitExtension(fileName: string): { stem: string; extension: string } {
  const extension = extname(fileName);
  const stem = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
  return { stem, extension };
}

/**
 * Strips a trailing ` v<digits>` (case-insensitive, optionally with an
 * `archived <N>` suffix that PP uses for older versions) from the stem.
 * Examples:
 *   `barber smith v47`               -> `barber smith`
 *   `barber smith V12 archived 3`    -> `barber smith`
 *   `barber smith`                   -> `barber smith`
 *   `intro - v9`                     -> `intro -`  (trimmed downstream)
 */
export function stripVersionSuffix(stem: string): string {
  const stripped = stem.replace(/[\s_-]?v\d+(?:[\s_-]*archived[\s_-]*\d+)?\s*$/i, '');
  return stripped.trimEnd();
}

/**
 * Computes the save-copy destination filename for `originalFileName`
 * targeting version `targetVersion`. The existing version suffix (if
 * any) is stripped first so the result is always a clean
 * `<stem> v<targetVersion><ext>`.
 */
export function buildSaveCopyFileName(originalFileName: string, targetVersion: number): string {
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    throw new Error(`Invalid target version number: ${String(targetVersion)}`);
  }

  const integer = Math.trunc(targetVersion);
  const { stem, extension } = splitExtension(originalFileName);
  const cleanStem = stripVersionSuffix(stem);
  // Guard against `splitExtension` returning an empty stem (e.g. a
  // hidden-style filename like `.als` with no stem). Fall back to a
  // generic stem so we never emit just ` v48.als`.
  const baseStem = cleanStem.length > 0 ? cleanStem : 'project';
  return `${baseStem} v${integer}${extension}`;
}

/**
 * Inserts a uniqueness disambiguator `(N)` between the stem and the
 * extension so we don't clobber an existing destination.
 *   `barber smith v48.als` + 2 -> `barber smith v48 (2).als`
 */
export function applyCollisionSuffix(fileName: string, attempt: number): string {
  if (!Number.isFinite(attempt) || attempt < 2) {
    return fileName;
  }
  const integer = Math.trunc(attempt);
  const { stem, extension } = splitExtension(fileName);
  return `${stem} (${integer})${extension}`;
}

// ---------------------------------------------------------------------------
// Version-number derivation
// ---------------------------------------------------------------------------

/**
 * Mirror of the renderer's `getVersionNumberFromFileName` (App.tsx),
 * kept self-contained so this module has no cross-package import.
 * Returns the trailing version number from a basename or `null` if
 * none is present.
 */
export function extractVersionNumberFromFileName(fileName: string): number | null {
  const { stem } = splitExtension(fileName);
  const match = stem.match(/(?:[\s_-]?v(\d+))(?:[\s_-]*archived[\s_-]*\d+)?$/i);
  if (!match) {
    return null;
  }
  const versionNumber = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(versionNumber) || versionNumber < 1) {
    return null;
  }
  return versionNumber;
}

/**
 * Computes the target version for a save-copy given the song's known
 * audio version filenames. Picks `max(existing) + 1`, or `1` when
 * there are no known versions yet. The caller is responsible for
 * passing whichever filenames represent the audio version pool —
 * usually `song.versions.map(v => v.fileName)`.
 */
export function computeNextSaveCopyVersion(audioVersionFileNames: readonly string[]): number {
  let highest = 0;
  for (const fileName of audioVersionFileNames) {
    const versionNumber = extractVersionNumberFromFileName(fileName);
    if (versionNumber !== null && versionNumber > highest) {
      highest = versionNumber;
    }
  }
  return highest >= 1 ? highest + 1 : 1;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const SAVE_COPY_MAX_COLLISION_ATTEMPTS = 50;

export type SongProjectSaveCopyResult =
  | { ok: true; newPath: string; newFileName: string; targetVersion: number }
  | { ok: false; error: string };

export interface SaveSongProjectCopyDeps {
  /** Returns `true` if `filePath` exists (file *or* directory). */
  exists: (filePath: string) => Promise<boolean>;
  /** Copies `source` to `destination`, preserving timestamps when possible. */
  copyFile: (source: string, destination: string) => Promise<void>;
}

const defaultDeps: SaveSongProjectCopyDeps = {
  async exists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async copyFile(source: string, destination: string) {
    // `fs.cp` with `preserveTimestamps` keeps mtime/atime so the
    // duplicated project file inherits the same modification time as
    // the original (helps Finder sorting / version-history clues).
    await fs.cp(source, destination, { preserveTimestamps: true, force: false, errorOnExist: true });
  },
};

export interface SaveSongProjectCopyOptions {
  originalPath: string;
  targetVersion: number;
}

/**
 * Performs the file-system side of the save-copy operation:
 *   1. Verify `originalPath` exists.
 *   2. Compute the destination filename in the same directory.
 *   3. If destination exists, bump `(2)`, `(3)`, ... up to
 *      `SAVE_COPY_MAX_COLLISION_ATTEMPTS` to avoid clobbering.
 *   4. Copy with timestamp preservation.
 */
export async function saveSongProjectCopy(
  options: SaveSongProjectCopyOptions,
  deps: SaveSongProjectCopyDeps = defaultDeps
): Promise<SongProjectSaveCopyResult> {
  const { originalPath, targetVersion } = options;

  if (typeof originalPath !== 'string' || originalPath.trim().length === 0) {
    return { ok: false, error: 'Original project file path is empty.' };
  }

  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return { ok: false, error: `Invalid target version number: ${String(targetVersion)}` };
  }

  const sourceExists = await deps.exists(originalPath);
  if (!sourceExists) {
    return {
      ok: false,
      error: `Original project file no longer exists on disk: ${originalPath}`,
    };
  }

  const sourceDir = dirname(originalPath);
  const sourceFileName = basename(originalPath);
  const baseFileName = buildSaveCopyFileName(sourceFileName, targetVersion);

  for (let attempt = 1; attempt <= SAVE_COPY_MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const candidateFileName = applyCollisionSuffix(baseFileName, attempt);
    const candidatePath = join(sourceDir, candidateFileName);

    if (candidatePath === originalPath) {
      // Defensive: never copy onto the source even if the target
      // version happens to match the existing trailing version.
      continue;
    }

    const collision = await deps.exists(candidatePath);
    if (collision) {
      continue;
    }

    try {
      await deps.copyFile(originalPath, candidatePath);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        error: `Failed to copy project file: ${message}`,
      };
    }

    return {
      ok: true,
      newPath: candidatePath,
      newFileName: candidateFileName,
      targetVersion: Math.trunc(targetVersion),
    };
  }

  return {
    ok: false,
    error: `Could not find a free filename after ${SAVE_COPY_MAX_COLLISION_ATTEMPTS} attempts.`,
  };
}

export const __testing__ = {
  buildSaveCopyFileName,
  stripVersionSuffix,
  splitExtension,
  applyCollisionSuffix,
  extractVersionNumberFromFileName,
  computeNextSaveCopyVersion,
};
