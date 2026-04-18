/**
 * v3.23 — polish batch E2E coverage.
 *
 * Covers the functional pieces of the v3.23 polish batch. Visual-only
 * items (big fullscreen readout, listening-device grid split, badge
 * hover outline left-clip fix, Windows help <details>) are skipped
 * here — they're exercised by the build + typecheck and verified
 * visually.
 *
 *  1. Platform Normalization Preview shows the amber "Using Reference"
 *     suffix whenever playbackPreviewMode === 'reference' (compact +
 *     fullscreen).
 *  2. Mastering Checklist (fullscreen only) shows the same amber
 *     "Using Reference" suffix in reference mode — and the checklist
 *     evaluates the REFERENCE track's analysis in that mode (rows
 *     still render, header text picks up the span).
 *  3. Cmd+R no longer reloads the Electron window — the default
 *     reload accelerator was removed from the View menu in
 *     apps/electron/src/main.ts. We assert two things: (a) the
 *     renderer's Mix/Reference toggle handler fires (app-shell's
 *     data-reference-mode flips) and (b) the DOM instance survives —
 *     a real reload would wipe our sentinel node.
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

test('v3.23 — Using-Reference indicators + Cmd+R no longer reloads', async () => {
  const dirs = await createE2ETestDirectories('v3-23-polish');

  const songPath = path.join(dirs.fixtureDirectory, 'Song v1.wav');
  const refPath = path.join(dirs.fixtureDirectory, 'Ref.wav');
  await writeSineWav(songPath, 220, 3);
  await writeSineWav(refPath, 440, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // Link folder → 1 song row.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // Seed the saved-references list + per-song pointer so opening the
    // song auto-loads Ref without going through the native file picker.
    const songId = await page
      .getByTestId('main-list-row')
      .first()
      .getAttribute('data-song-id');
    expect(songId).toBeTruthy();

    await page.evaluate(
      (args) => {
        const { songId, refPath } = args;
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: refPath,
              fileName: 'Ref.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ]),
        );
        window.localStorage.setItem(`producer-player.reference-track.${songId}`, refPath);
        window.localStorage.setItem(`producer-player.restore-reference.${songId}`, '1');
      },
      { songId: songId as string, refPath },
    );

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // Tag the live DOM with a sentinel so we can prove the page did not
    // actually reload later.
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = '__v3_23_cmd_r_sentinel__';
      marker.style.display = 'none';
      document.body.appendChild(marker);
    });

    await page.getByTestId('main-list-row').first().click();

    // Wait for the reference to finish loading.
    await expect(page.getByTestId('analysis-reference-summary')).toContainText(
      'Ref.wav',
      { timeout: 20_000 },
    );

    // Enter reference playback mode. We drive this through the Mix/Ref
    // toggle UI (the `Reference` button inside .analysis-ab-actions) to
    // avoid depending on platform-specific keystroke timing for the
    // pre-condition; Cmd+R is tested separately below.
    const refModeButton = page
      .locator('.analysis-ab-actions button')
      .filter({ hasText: /^Reference$/ })
      .first();
    await refModeButton.click();
    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-reference-mode',
      'true',
    );

    // (1) Platform Normalization Preview — compact view, header picks up
    // the amber .reference-text "Using Reference" suffix.
    const compactNormPanel = page.getByTestId('analysis-normalization-panel');
    await expect(compactNormPanel).toBeVisible();
    await expect(
      compactNormPanel.locator('.reference-text').filter({ hasText: 'Using Reference' }),
    ).toBeVisible();

    // Open fullscreen overlay.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    // (1b) Platform Normalization — fullscreen overlay header.
    const overlayNormPanel = page.getByTestId('analysis-overlay-normalization-panel');
    await expect(overlayNormPanel).toBeVisible();
    await expect(
      overlayNormPanel.locator('.reference-text').filter({ hasText: 'Using Reference' }),
    ).toBeVisible();

    // (2) Mastering Checklist — fullscreen-only. Should show the same
    // "Using Reference" amber suffix AND still render its rows even
    // when reference mode is active (evaluation source switches to the
    // reference's analysis).
    const checklistPanel = page.getByTestId('analysis-mastering-checklist');
    await expect(checklistPanel).toBeVisible();
    await expect(
      checklistPanel.locator('.reference-text').filter({ hasText: 'Using Reference' }),
    ).toBeVisible();
    // At least the LUFS + True Peak rows should render.
    await expect(checklistPanel.locator('.mastering-checklist-row')).toHaveCount(4);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    // (3) Cmd+R must NOT reload the Electron window.
    //
    // Before v3.23, the View-menu `role: 'reload'` entry bound Cmd+R
    // (CmdOrCtrl+R) to a real reload and beat the renderer's keydown
    // listener. We assert two independent facts:
    //
    //   (a) The renderer's Mix/Reference shortcut handler still runs,
    //       flipping data-reference-mode.
    //   (b) The sentinel <div> we appended to document.body before the
    //       keypress is still there afterwards. A real reload would
    //       wipe it.
    //
    // Pre-condition: we're currently in reference mode
    // (data-reference-mode="true"), so pressing Cmd+R should flip us
    // BACK to mix.
    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-reference-mode',
      'true',
    );

    // Make sure focus isn't inside an input (the shortcut handler
    // bails early on text-entry elements per isTextEntryElement()).
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.focus();
    });

    await page.keyboard.press('Meta+KeyR');

    // Flip to mix should happen synchronously in the keydown handler;
    // give React one tick.
    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-reference-mode',
      'false',
      { timeout: 2_000 },
    );

    // Sentinel survives — no reload happened.
    const sentinelStillThere = await page.evaluate(
      () => document.getElementById('__v3_23_cmd_r_sentinel__') !== null,
    );
    expect(sentinelStillThere).toBe(true);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
