/**
 * v3.221 — pure orchestrator for "Save Copy on All".
 *
 * Iterates a list of songs, calls the per-song save-copy IPC for each
 * one in sequence, reports progress, and aggregates a final
 * succeeded/failed/skipped breakdown. Pure / no React imports so it
 * can be unit-tested in isolation.
 *
 * Voice 3132 (2026-05-14): "have a new button called 'Save Copy on
 * All' that just triggers a save copy of every track's DAW project."
 *
 * Sequential (one at a time) — the per-song handler ultimately hits
 * the filesystem on the main process; we don't want parallel writes
 * of large .als / .logicx bundles racing against each other.
 */

import type { SongProjectSaveCopyResult } from '@producer-player/contracts';

export interface BulkSaveCopyInputSong {
  /** Stable song id (for progress + failure reporting). */
  id: string;
  /** Human-readable title for failure messages. */
  title: string;
  /**
   * Absolute path to the song's linked DAW project file. `null` if
   * the song has no linked project — those are skipped, not failed.
   */
  projectFilePath: string | null;
  /** Version number to tag the saved copy with (matches per-song flow). */
  targetVersion: number;
}

export interface BulkSaveCopyProgress {
  /** 1-based index of the song currently being processed. */
  currentIndex: number;
  /** Total songs with a linked project (denominator the user sees). */
  totalEligible: number;
  /** The song currently being processed. */
  song: BulkSaveCopyInputSong;
}

export interface BulkSaveCopyOutcome {
  song: BulkSaveCopyInputSong;
  kind: 'success' | 'failure' | 'skipped-no-project';
  /** Populated when `kind === 'success'`. */
  result?: Extract<SongProjectSaveCopyResult, { ok: true }>;
  /** Populated when `kind === 'failure'`. */
  error?: string;
}

export interface BulkSaveCopySummary {
  total: number;
  eligible: number;
  succeeded: number;
  failed: number;
  skippedNoProject: number;
  outcomes: BulkSaveCopyOutcome[];
}

export interface BulkSaveCopyDeps {
  /**
   * Wraps the per-song IPC call. Tests inject a fake; production code
   * passes `window.producerPlayer.saveSongProjectCopy`.
   */
  saveSongProjectCopy(
    originalPath: string,
    targetVersion: number
  ): Promise<SongProjectSaveCopyResult>;
  /** Optional progress observer — called once per eligible song before the IPC fires. */
  onProgress?(progress: BulkSaveCopyProgress): void;
  /** Optional per-outcome observer — called after each song completes (success OR failure). */
  onOutcome?(outcome: BulkSaveCopyOutcome): void;
}

/**
 * Run the bulk save-copy flow. Always resolves with a summary, never
 * throws — per-song failures are captured in the summary so the
 * caller can decide how to surface them (toast, log, etc.).
 */
export async function bulkSaveSongProjectCopies(
  songs: readonly BulkSaveCopyInputSong[],
  deps: BulkSaveCopyDeps
): Promise<BulkSaveCopySummary> {
  const outcomes: BulkSaveCopyOutcome[] = [];
  const eligibleSongs = songs.filter((song) => song.projectFilePath !== null);
  const totalEligible = eligibleSongs.length;

  // First pass: surface every "no project linked" song as a skipped
  // outcome so the final summary numbers match the input length.
  for (const song of songs) {
    if (song.projectFilePath === null) {
      const outcome: BulkSaveCopyOutcome = {
        song,
        kind: 'skipped-no-project',
      };
      outcomes.push(outcome);
      deps.onOutcome?.(outcome);
    }
  }

  let currentIndex = 0;
  for (const song of eligibleSongs) {
    currentIndex += 1;
    // `projectFilePath` non-null asserted above via filter().
    const projectFilePath = song.projectFilePath as string;

    deps.onProgress?.({
      currentIndex,
      totalEligible,
      song,
    });

    let outcome: BulkSaveCopyOutcome;
    try {
      const result = await deps.saveSongProjectCopy(projectFilePath, song.targetVersion);
      if (result.ok) {
        outcome = {
          song,
          kind: 'success',
          result,
        };
      } else {
        outcome = {
          song,
          kind: 'failure',
          error: result.error,
        };
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      outcome = {
        song,
        kind: 'failure',
        error: message,
      };
    }
    outcomes.push(outcome);
    deps.onOutcome?.(outcome);
  }

  return summarize(songs.length, totalEligible, outcomes);
}

function summarize(
  total: number,
  eligible: number,
  outcomes: BulkSaveCopyOutcome[]
): BulkSaveCopySummary {
  let succeeded = 0;
  let failed = 0;
  let skippedNoProject = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === 'success') succeeded += 1;
    else if (outcome.kind === 'failure') failed += 1;
    else skippedNoProject += 1;
  }
  return {
    total,
    eligible,
    succeeded,
    failed,
    skippedNoProject,
    outcomes,
  };
}

/**
 * Build the success/partial/failure toast text from a summary.
 * Pure; tested separately.
 */
export function buildBulkSaveCopyToastText(summary: BulkSaveCopySummary): {
  kind: 'success' | 'warning' | 'error' | 'info';
  text: string;
} {
  const { eligible, succeeded, failed, skippedNoProject } = summary;

  if (eligible === 0) {
    return {
      kind: 'info',
      text: 'No tracks have a linked DAW project to save a copy of.',
    };
  }

  if (failed === 0 && succeeded === eligible) {
    const skippedSuffix =
      skippedNoProject > 0
        ? ` (${skippedNoProject} track${skippedNoProject === 1 ? '' : 's'} skipped — no linked DAW project)`
        : '';
    return {
      kind: 'success',
      text: `Saved ${succeeded} ${succeeded === 1 ? 'copy' : 'copies'}${skippedSuffix}`,
    };
  }

  if (succeeded === 0) {
    return {
      kind: 'error',
      text: `Failed to save copies for all ${eligible} tracks. See log for details.`,
    };
  }

  return {
    kind: 'warning',
    text: `Saved ${succeeded} of ${eligible} copies, ${failed} failed. See log for details.`,
  };
}

/**
 * v3.221 — tooltip text for the per-track Save Copy button. Voice
 * 3133 (2026-05-14): "The Save Copy tooltip should specify it's for
 * the DAW project — DAW project — because I think it's a little
 * confusing. Is it the track or is it the project?"
 *
 * Kept as a constant so the test can assert on the EXACT phrase
 * without touching the JSX tree.
 */
export const SAVE_COPY_TOOLTIP_HEADING = 'Save copy of DAW project';

export function buildSaveCopyTooltipBody(targetVersion: number): string {
  return (
    `Duplicates this song's DAW project file (e.g. song v${targetVersion}.als) next to the original ` +
    `and tags it with the current version number. Re-clicks append (2), (3), etc. — never overwrites ` +
    `the source project.`
  );
}
