#!/usr/bin/env node
/**
 * One-shot maintenance script for cleaning up DAW sidecar files
 * (Ableton `.asd`, Reaper `.reapeaks`, Logic `.peak`, generic `.peaks`)
 * that were left stranded at the top level of a Producer Player folder
 * because earlier versions of the app moved audio files into `old/`
 * without bringing their sidecars along.
 *
 * Usage:
 *   node scripts/cleanup-orphaned-sidecars.mjs /path/to/MusicOutput
 *   node scripts/cleanup-orphaned-sidecars.mjs --dry-run /path/to/MusicOutput
 *
 * For each top-level `*.<sidecar-ext>` file, the script:
 *   - Computes the matching audio file name (strip the sidecar extension)
 *   - If the audio file is NOT at the top level but IS in `old/`, moves
 *     the sidecar into `old/` (alongside its audio).
 *   - Otherwise skips it (audio is still at top level, or audio is
 *     genuinely gone — both cases are intentionally left alone).
 *
 * Safe to run multiple times. Use --dry-run first to inspect what would
 * change without touching disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DAW_SIDECAR_EXTENSIONS = ['.asd', '.reapeaks', '.peak', '.peaks'];

function parseArgs(argv) {
  const args = { dryRun: false, folder: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-n') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.folder) {
      args.folder = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node scripts/cleanup-orphaned-sidecars.mjs [--dry-run] <folder>\n' +
      '\n' +
      'Move stranded DAW sidecar files (.asd / .reapeaks / .peak / .peaks)\n' +
      'from the top level of <folder> into <folder>/old/ when their matching\n' +
      'audio file is already in <folder>/old/.\n'
  );
}

function getSidecarExtension(fileName) {
  const lower = fileName.toLowerCase();
  for (const extension of DAW_SIDECAR_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return extension;
    }
  }
  return null;
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveNonCollidingPath(targetPath) {
  if (!(await pathExists(targetPath))) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let counter = 1;
  // Mirror the service's `-archived-N` collision strategy.
  while (true) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}-archived-${counter}${parsed.ext}`
    );
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(2);
  }

  if (args.help || !args.folder) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const folder = path.resolve(args.folder);
  const oldFolder = path.join(folder, 'old');

  let folderStat;
  try {
    folderStat = await fs.stat(folder);
  } catch (error) {
    console.error(`Cannot access folder: ${folder}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (!folderStat.isDirectory()) {
    console.error(`Not a directory: ${folder}`);
    process.exit(1);
  }

  let topEntries;
  try {
    topEntries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    console.error(`Failed to read folder: ${folder}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const oldFolderExists = await pathExists(oldFolder);

  let moved = 0;
  let skipped = 0;

  for (const entry of topEntries) {
    if (!entry.isFile()) {
      continue;
    }

    const sidecarExtension = getSidecarExtension(entry.name);
    if (!sidecarExtension) {
      continue;
    }

    // The audio filename is the sidecar name minus the trailing sidecar
    // extension. e.g. `barber smith v45.wav.asd` -> `barber smith v45.wav`.
    const audioFileName = entry.name.slice(0, -sidecarExtension.length);
    if (audioFileName.length === 0) {
      skipped += 1;
      continue;
    }

    const topLevelAudioPath = path.join(folder, audioFileName);
    const oldAudioPath = path.join(oldFolder, audioFileName);

    const audioAtTop = await pathExists(topLevelAudioPath);
    if (audioAtTop) {
      // Audio still at the top level — sidecar belongs here too.
      skipped += 1;
      continue;
    }

    if (!oldFolderExists) {
      skipped += 1;
      continue;
    }

    const audioInOld = await pathExists(oldAudioPath);
    if (!audioInOld) {
      // No matching audio anywhere we recognise — leave the sidecar alone.
      skipped += 1;
      continue;
    }

    const sourceSidecar = path.join(folder, entry.name);
    const desiredTarget = path.join(oldFolder, entry.name);
    const finalTarget = await resolveNonCollidingPath(desiredTarget);

    if (args.dryRun) {
      console.log(`would move: ${sourceSidecar} -> ${finalTarget}`);
      moved += 1;
      continue;
    }

    try {
      await fs.rename(sourceSidecar, finalTarget);
      console.log(`moved: ${sourceSidecar} -> ${finalTarget}`);
      moved += 1;
    } catch (error) {
      // Fallback for cross-device renames.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EXDEV'
      ) {
        try {
          await fs.copyFile(sourceSidecar, finalTarget);
          await fs.unlink(sourceSidecar);
          console.log(`moved (copy+unlink): ${sourceSidecar} -> ${finalTarget}`);
          moved += 1;
        } catch (copyError) {
          console.error(
            `failed: ${sourceSidecar}: ${copyError instanceof Error ? copyError.message : String(copyError)}`
          );
          skipped += 1;
        }
      } else {
        console.error(
          `failed: ${sourceSidecar}: ${error instanceof Error ? error.message : String(error)}`
        );
        skipped += 1;
      }
    }
  }

  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}moved ${moved} orphan${moved === 1 ? '' : 's'}, skipped ${skipped} (no match)`
  );
}

await main();
