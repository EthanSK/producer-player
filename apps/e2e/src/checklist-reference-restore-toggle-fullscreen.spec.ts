/**
 * v3.19.0 — fullscreen-overlay twin of checklist-reference-restore-toggle.spec.
 *
 * The per-song "Restore this reference when I open this track" toggle
 * originally shipped in v3.16 (b7f8182) but was only wired into the
 * compact reference panel. v3.19 adds the same toggle to the fullscreen
 * mastering overlay. This spec exercises the fullscreen copy of the
 * toggle end-to-end:
 *
 *   A. Toggle is visible inside the fullscreen overlay and unchecked by
 *      default for a freshly selected song.
 *   B. Toggling ON from the fullscreen overlay causes the saved
 *      reference to auto-restore when the track is re-opened (reload
 *      round-trip, like a close+reopen of the app).
 *   C. Toggling OFF again from the fullscreen overlay means the saved
 *      reference is NOT auto-loaded after reload — the default opt-in
 *      behavior still holds.
 *
 * Fixture audio must be real decodable WAV (ffmpeg sine waves) because
 * the reference-load pipeline actually decodes through
 * analyzeAudioFile — raw byte stubs would throw and nuke the
 * referenceTrack, spuriously failing scenario B.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

async function writeSineWav(
  filePath: string,
  frequencyHz: number,
  durationSec: number,
): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequencyHz}:duration=${durationSec}`,
    '-c:a',
    'pcm_s16le',
    filePath,
  ]);
}

test('fullscreen mastering overlay exposes the per-song restore-reference toggle', async () => {
  const dirs = await createE2ETestDirectories('reference-restore-toggle-fullscreen');

  const songAPath = path.join(dirs.fixtureDirectory, 'Song A v1.wav');
  const songBPath = path.join(dirs.fixtureDirectory, 'Song B v1.wav');
  const refPath = path.join(dirs.fixtureDirectory, 'Ref For A.wav');
  await writeSineWav(songAPath, 180, 3);
  await writeSineWav(songBPath, 260, 3);
  await writeSineWav(refPath, 440, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    console.log('[spec] linking fixture folder');
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });

    const songARow = page.getByTestId('main-list-row').filter({ hasText: 'Song A' });
    const songBRow = page.getByTestId('main-list-row').filter({ hasText: 'Song B' });
    const songAId = await songARow.first().getAttribute('data-song-id');
    const songBId = await songBRow.first().getAttribute('data-song-id');
    expect(songAId).toBeTruthy();
    expect(songBId).toBeTruthy();
    expect(songAId).not.toBe(songBId);

    console.log('[spec] seeding song A saved reference');
    await page.evaluate(
      (args) => {
        const { songId, refPath } = args;
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: refPath,
              fileName: 'Ref For A.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ]),
        );
        window.localStorage.setItem(
          `producer-player.reference-track.${songId}`,
          refPath,
        );
      },
      { songId: songAId as string, refPath },
    );

    console.log('[spec] reload (1) to apply seeded state');
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });

    // Select song A.
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    // ====================================================================
    // Scenario A — toggle is visible in the fullscreen overlay, default OFF
    // ====================================================================
    console.log('[spec] scenario A: open fullscreen overlay and check default state');
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    const toggleFs = page.getByTestId('analysis-reference-restore-toggle-fullscreen');
    const toggleFsInput = page.getByTestId('analysis-reference-restore-toggle-input-fullscreen');
    await expect(toggleFs).toBeVisible();
    await expect(toggleFsInput).toBeVisible();
    await expect(toggleFsInput).not.toBeChecked();

    // Default OFF — there should be no auto-restore yet.
    const referenceSummary = page.getByTestId('analysis-reference-summary');
    await expect(referenceSummary).toHaveText(/no reference/i, { timeout: 5_000 });

    // ====================================================================
    // Scenario B — toggle ON via the fullscreen overlay, reload, verify
    // the saved reference auto-loads.
    // ====================================================================
    console.log('[spec] scenario B: toggle ON from fullscreen, reload, expect auto-restore');
    await toggleFsInput.check();
    await expect(toggleFsInput).toBeChecked();

    // Let the debounced unified-state sync flush to disk.
    await page.waitForTimeout(1200);

    // Close the overlay, then reload (simulates close+reopen of PP).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    // Saved reference should auto-load because the toggle is ON for song A.
    await expect(referenceSummary).toContainText('Ref For A.wav', { timeout: 15_000 });

    // Re-open fullscreen and confirm the toggle reflects the persisted ON state.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
    const toggleFsInputAfterReload = page.getByTestId(
      'analysis-reference-restore-toggle-input-fullscreen',
    );
    await expect(toggleFsInputAfterReload).toBeVisible();
    await expect(toggleFsInputAfterReload).toBeChecked();

    // ====================================================================
    // Scenario C — toggle OFF from fullscreen, reload, verify NO auto-load.
    // ====================================================================
    console.log('[spec] scenario C: toggle OFF from fullscreen, reload, expect no auto-restore');
    await toggleFsInputAfterReload.uncheck();
    await expect(toggleFsInputAfterReload).not.toBeChecked();

    // Flush the debounced write to disk, then clear the currently-loaded
    // reference so "did the reload re-load it?" is a meaningful assertion.
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    // Switch away to song B so the next select-song-A definitely re-runs
    // the auto-restore path (not just the "already loaded" guard).
    await page.getByTestId('main-list-row').filter({ hasText: 'Song B' }).first().click();
    await page.waitForTimeout(300);

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    // Give auto-restore a chance to (incorrectly) fire.
    await page.waitForTimeout(1500);
    await expect(referenceSummary).toHaveText(/no reference/i, { timeout: 5_000 });
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
