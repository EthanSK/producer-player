/**
 * v3.16.0 — per-track "restore reference on open" toggle.
 *
 * Default OFF: the user's saved reference is NEVER auto-loaded on song
 * switch unless the per-song toggle is explicitly ON. The SAVE path (a
 * reference gets persisted when picked) is unchanged and always-on —
 * this spec only exercises the RESTORE-on-switch behavior and the
 * toggle UI state persistence.
 *
 * Three scenarios:
 *   A. Default OFF → no auto-restore on track switch.
 *   B. Toggled ON → auto-restore fires on track switch.
 *   C. Toggle state persists across reload (via unified user state).
 *
 * All three are combined into one spec to minimize Electron launches.
 *
 * The fixture files must be REAL decodable WAV audio because the
 * reference-load pipeline actually decodes audio through analyzeAudioFile.
 * Using raw "RIFF stub" byte contents makes analyzeTrackFromUrl throw,
 * which sends the silent-missing branch and nukes referenceTrack — which
 * would make the "saved reference auto-loads after toggle ON" assertion
 * fail spuriously.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
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

test('per-song restore-reference toggle gates auto-restore and persists across reload', async () => {
  const dirs = await createE2ETestDirectories('reference-restore-toggle');

  // Real (decodable) WAVs — otherwise the reference-load pipeline throws
  // on the fake byte contents and our scenario-B assertion never sees the
  // reference successfully load.
  const songAPath = path.join(dirs.fixtureDirectory, 'Song A v1.wav');
  const songBPath = path.join(dirs.fixtureDirectory, 'Song B v1.wav');
  const refPath = path.join(dirs.fixtureDirectory, 'Ref For A.wav');
  await writeSineWav(songAPath, 180, 3);
  await writeSineWav(songBPath, 260, 3);
  await writeSineWav(refPath, 440, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link the folder so we have two song rows.
    console.log('[spec] linking fixture folder');
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });

    // The spec only needs TWO switchable rows; we pick "Song A" / "Song B"
    // by filename so the test is robust against file-order/sort tweaks.
    const songARow = page.getByTestId('main-list-row').filter({ hasText: 'Song A' });
    const songBRow = page.getByTestId('main-list-row').filter({ hasText: 'Song B' });
    const songAId = await songARow.first().getAttribute('data-song-id');
    const songBId = await songBRow.first().getAttribute('data-song-id');
    expect(songAId).toBeTruthy();
    expect(songBId).toBeTruthy();
    expect(songAId).not.toBe(songBId);

    // 2. Seed song A with a saved reference pointer + saved-reference list
    //    entry pointing at the real Ref For A.wav file. This bypasses the
    //    native "choose file" dialog (which can't be driven in headless
    //    mode) and matches the shape the renderer uses.
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

    // Reload so the renderer picks up the seeded localStorage values
    // cleanly before any auto-restore useEffect has fired.
    console.log('[spec] reload (1) to apply seeded state');
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });

    // ===================================================================
    // Scenario A — default OFF: auto-restore does NOT fire
    // ===================================================================
    console.log('[spec] scenario A: default OFF, expect no auto-restore');
    // Select song A — default toggle is OFF, so the saved reference must
    // NOT be auto-loaded.
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    // Give the auto-restore useEffect room to (incorrectly) fire.
    await page.waitForTimeout(1500);

    // The compact reference panel's summary reads "No reference" when
    // nothing is loaded. We assert that here. Using the `data-testid`
    // plus the text-contains assertion is robust against minor copy tweaks.
    const referenceSummary = page.getByTestId('analysis-reference-summary');
    await expect(referenceSummary).toHaveText(/no reference/i, { timeout: 5_000 });

    // Toggle checkbox exists and is unchecked.
    const toggleInput = page.getByTestId('analysis-reference-restore-toggle-input');
    await expect(toggleInput).toBeVisible();
    await expect(toggleInput).not.toBeChecked();

    // ===================================================================
    // Scenario B — toggle ON: auto-restore fires on next switch
    // ===================================================================
    console.log('[spec] scenario B: toggle ON, switch away + back, expect auto-restore');
    await toggleInput.check();
    await expect(toggleInput).toBeChecked();

    // Switch to song B first to clear the "already loaded this song" guard.
    await page.getByTestId('main-list-row').filter({ hasText: 'Song B' }).first().click();
    await page.waitForTimeout(500);

    // Switch back to song A — the saved reference should now auto-load.
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    // Wait up to 15s for the reference summary text to flip from "No
    // reference" to something containing the reference file name (audio
    // decode + meter warm-up can take a couple of seconds).
    await expect(referenceSummary).toContainText('Ref For A.wav', { timeout: 15_000 });

    // ===================================================================
    // Scenario C — toggle persists across reload
    // ===================================================================
    console.log('[spec] scenario C: reload, toggle state persists');

    // Give the debounced unified-state sync (500ms) a chance to flush the
    // toggle to disk before we reload.
    await page.waitForTimeout(1200);

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15_000 });
    await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().click();

    const toggleAfterReload = page.getByTestId('analysis-reference-restore-toggle-input');
    await expect(toggleAfterReload).toBeVisible();
    await expect(toggleAfterReload).toBeChecked();

    // And the unified user-state on disk carries the flag too, so a
    // cross-machine import / reinstall inherits the opt-in.
    const userStatePath = path.join(
      dirs.userDataDirectory,
      'producer-player-user-state.json',
    );
    const rawUserState = await fs.readFile(userStatePath, 'utf8');
    const parsedUserState = JSON.parse(rawUserState) as {
      perSongRestoreReferenceEnabled?: Record<string, boolean>;
    };
    expect(parsedUserState.perSongRestoreReferenceEnabled?.[songAId as string]).toBe(
      true,
    );
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
