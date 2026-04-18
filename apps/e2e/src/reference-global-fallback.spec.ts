/**
 * v3.22.0 — global-reference fallback and fullscreen-remount hydration.
 *
 * Covers two related reference-track restore bugs:
 *
 * Bug 1 — Stale React state on fullscreen remount. The fullscreen
 * mastering overlay unmounts when `analysisExpanded` flips to false
 * and remounts when it flips back to true, but the hydration useEffect
 * keyed on `[selectedSongId, unifiedStateReady, restoreReferenceImportSignal]`
 * didn't re-fire on overlay mount. The fullscreen checkbox could
 * therefore display a stale React state value disagreeing with
 * localStorage. Fix: add `analysisExpanded` to that dep array so every
 * overlay mount re-reads from localStorage.
 *
 * Bug 2 — Global-reference fallback on switching to a restore=OFF
 * track. From Ethan's voice note 4759: "When I go back to a track that
 * has 'Restore this reference when I open this track' OFF, it should
 * go back to whatever the last globally set reference track was —
 * instead of staying on the one set by the previous track that had
 * restore ON." Fix: track the last MANUALLY-picked reference in
 * `producer-player.reference-track-global.v1` + mirror to unified
 * state; use it as the fallback when switching to a restore=OFF song.
 *
 * Scenarios:
 *   1. fullscreen-remount toggle=ON → checkbox still shows ON.
 *   2. fullscreen-remount toggle=OFF → checkbox still shows OFF.
 *   3. manually pick ref X, switch to A (restore=ON, saved=Y) → loads
 *      Y, then switch to B (restore=OFF) → shows X (global), not Y.
 *   4. manually pick ref X, switch to B (restore=OFF, no saved) → B
 *      shows X (global fallback).
 *
 * Real decodable WAVs are required because the reference-load path
 * actually decodes audio via analyzeAudioFile.
 */
import { spawn } from 'node:child_process';
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

test('reference-global fallback + fullscreen-remount hydration', async () => {
  const dirs = await createE2ETestDirectories('reference-global-fallback');

  // Three songs so we can exercise "switch away + switch back" cleanly
  // across multiple scenarios. Song A gets a saved-reference "Y", Song B
  // gets no saved reference (restore=OFF), Song C sits idle so we can
  // park on it between scenarios.
  const songAPath = path.join(dirs.fixtureDirectory, 'Song A v1.wav');
  const songBPath = path.join(dirs.fixtureDirectory, 'Song B v1.wav');
  const songCPath = path.join(dirs.fixtureDirectory, 'Song C v1.wav');
  const refXPath = path.join(dirs.fixtureDirectory, 'Ref X.wav');
  const refYPath = path.join(dirs.fixtureDirectory, 'Ref Y.wav');

  await writeSineWav(songAPath, 180, 3);
  await writeSineWav(songBPath, 260, 3);
  await writeSineWav(songCPath, 320, 3);
  await writeSineWav(refXPath, 440, 3);
  await writeSineWav(refYPath, 660, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // Link the folder.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(3, { timeout: 15_000 });

    const songAId = await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song A' })
      .first()
      .getAttribute('data-song-id');
    const songBId = await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song B' })
      .first()
      .getAttribute('data-song-id');
    expect(songAId).toBeTruthy();
    expect(songBId).toBeTruthy();
    expect(songAId).not.toBe(songBId);

    // Seed song A with saved reference Y and restore=ON for Song A only.
    // Song B has no saved reference and its restore toggle stays default OFF.
    // Also seed BOTH Ref X and Ref Y into the saved-references list so
    // handleLoadReferenceByFilePath's saved-reference lookup succeeds.
    await page.evaluate(
      (args) => {
        const { songAId, refXPath, refYPath } = args;
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: refYPath,
              fileName: 'Ref Y.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
            {
              filePath: refXPath,
              fileName: 'Ref X.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ]),
        );
        // Song A: saved reference Y, restore=ON
        window.localStorage.setItem(
          `producer-player.reference-track.${songAId}`,
          refYPath,
        );
        window.localStorage.setItem(
          `producer-player.restore-reference.${songAId}`,
          '1',
        );
      },
      { songAId: songAId as string, refXPath, refYPath },
    );

    // Reload so seeded values are picked up cleanly.
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(3, { timeout: 15_000 });

    // ==================================================================
    // Scenario 1 — Bug 1 proof, toggle=ON survives fullscreen remount
    // ==================================================================
    // Song A's restore toggle is ON. Open fullscreen, confirm checked.
    // Close, reopen, still checked. Without Bug 1's fix the checkbox
    // could display a stale value.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song A' })
      .first()
      .click();

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    const toggleFsInput = page.getByTestId(
      'analysis-reference-restore-toggle-input-fullscreen',
    );
    await expect(toggleFsInput).toBeVisible();
    await expect(toggleFsInput).toBeChecked();

    // Close the overlay (forces unmount) then reopen (remount).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
    const toggleFsInputAfterRemount1 = page.getByTestId(
      'analysis-reference-restore-toggle-input-fullscreen',
    );
    await expect(toggleFsInputAfterRemount1).toBeVisible();
    await expect(toggleFsInputAfterRemount1).toBeChecked();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    // ==================================================================
    // Scenario 2 — Bug 1 proof, toggle=OFF survives fullscreen remount
    // ==================================================================
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song B' })
      .first()
      .click();

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    const toggleFsB1 = page.getByTestId(
      'analysis-reference-restore-toggle-input-fullscreen',
    );
    await expect(toggleFsB1).toBeVisible();
    await expect(toggleFsB1).not.toBeChecked();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
    const toggleFsB2 = page.getByTestId(
      'analysis-reference-restore-toggle-input-fullscreen',
    );
    await expect(toggleFsB2).toBeVisible();
    await expect(toggleFsB2).not.toBeChecked();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    // ==================================================================
    // Scenario 3 — Bug 2 proof. Manually pick ref X (global). Switch to
    // A (restore=ON, saved=Y) → loads Y. Switch to B (restore=OFF) →
    // expect X (global), NOT Y.
    // ==================================================================
    // Manually pick Ref X by writing the global-reference localStorage
    // key directly. The renderer's restore=OFF fallback reads that key
    // synchronously via readGlobalReference() on every song switch, so
    // no reload is necessary — but we park on Song C first so the next
    // song switch isn't a "same song" no-op.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song C' })
      .first()
      .click();
    await page.waitForTimeout(500);

    await page.evaluate(
      (args) => {
        const { refXPath } = args;
        // Mirrors what loadReferenceTrack does when markAsGlobalReference
        // is set (handleChooseReferenceTrack / handleUseCurrentTrackAsReference
        // path). We avoid driving the native file-picker dialog by writing
        // the localStorage key directly — the renderer reads it live on
        // every song switch via readGlobalReference().
        window.localStorage.setItem(
          'producer-player.reference-track-global.v1',
          refXPath,
        );
      },
      { refXPath },
    );

    // Switch to Song A: restore=ON, saved=Y → expect Ref Y loads.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song A' })
      .first()
      .click();

    const referenceSummary = page.getByTestId('analysis-reference-summary');
    await expect(referenceSummary).toContainText('Ref Y.wav', { timeout: 15_000 });

    // Switch to Song B: restore=OFF → expect FALLBACK to global Ref X,
    // NOT staying on Ref Y that Song A just loaded.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song B' })
      .first()
      .click();

    await expect(referenceSummary).toContainText('Ref X.wav', { timeout: 15_000 });
    await expect(referenceSummary).not.toContainText('Ref Y.wav');

    // ==================================================================
    // Scenario 4 — manually pick ref X + switch to a restore=OFF track
    // with no prior global. We already verified the "with global" case
    // above; this scenario covers the "no global" edge case: clearing
    // the global pick should mean the restore=OFF track shows "no
    // reference" (not the previous track's leftover).
    // ==================================================================
    // First park on Song C then clear the global reference. No reload
    // needed — the restore=OFF fallback reads localStorage live.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song C' })
      .first()
      .click();
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.localStorage.removeItem('producer-player.reference-track-global.v1');
    });

    // Switch to Song A (restore=ON) to load Ref Y.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song A' })
      .first()
      .click();
    await expect(referenceSummary).toContainText('Ref Y.wav', { timeout: 15_000 });

    // Switch to Song B (restore=OFF, no global): expect "no reference",
    // NOT lingering Ref Y.
    await page
      .getByTestId('main-list-row')
      .filter({ hasText: 'Song B' })
      .first()
      .click();
    await expect(referenceSummary).toHaveText(/no reference/i, { timeout: 5_000 });
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
