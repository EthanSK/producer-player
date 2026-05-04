/**
 * v3.110 — K-weighting / LUFS frequency-weighting curve modal.
 *
 * Adds an explainer modal accessible from a small `f(w)` button in the
 * fullscreen mastering header (immediately to the LEFT of the ✨ AI Stars
 * button). The modal plots the ITU-R BS.1770-4 K-weighting shape and
 * explains, in honest copy, that this is the per-frequency WEIGHT applied
 * during LUFS measurement — not a per-frequency loudness reading of the
 * user's track.
 *
 * This spec covers:
 *   1. The button is rendered in the fullscreen mastering header, to the
 *      LEFT of the ✨ AI Stars button.
 *   2. Clicking the button opens the modal, which contains a canvas plot
 *      and the explanation copy.
 *   3. Closing via the Close button or Escape key dismisses the modal
 *      without leaking it across re-opens.
 *   4. The explanation copy uses honest "weight" wording — does NOT say
 *      "LUFS at frequency", which would be misleading.
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

test('k-weighting modal opens from the mastering header and displays the BS.1770 curve', async () => {
  const dirs = await createE2ETestDirectories('k-weighting-modal');
  const songPath = path.join(dirs.fixtureDirectory, 'Test Song v1.wav');
  await writeSineWav(songPath, 440, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId('main-list-row').first().click();

    // Open the fullscreen mastering analysis modal.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    // The K-weighting button must be present and to the LEFT of the
    // ✨ AI Stars button (DOM order = visual order in the flex header).
    const headerActions = page.locator('.analysis-overlay-header-actions');
    const kButton = headerActions.getByTestId('k-weighting-open');
    const aiButton = headerActions.getByTestId('ai-rec-regenerate');
    await expect(kButton).toBeVisible();
    await expect(aiButton).toBeVisible();

    const kBox = await kButton.boundingBox();
    const aiBox = await aiButton.boundingBox();
    expect(kBox).not.toBeNull();
    expect(aiBox).not.toBeNull();
    if (kBox && aiBox) {
      // Left-of: K button's right edge should be ≤ AI button's left edge
      // (i.e. K sits visually to the left of AI in the header).
      expect(kBox.x + kBox.width).toBeLessThanOrEqual(aiBox.x + 1);
    }

    // Modal not yet open.
    await expect(page.getByTestId('k-weighting-modal')).toHaveCount(0);

    // Open the modal.
    await kButton.click();
    await expect(page.getByTestId('k-weighting-modal')).toBeVisible();
    await expect(page.getByTestId('k-weighting-modal-title')).toContainText('Frequency weighting');
    await expect(page.getByTestId('k-weighting-canvas')).toBeVisible();
    await expect(page.getByTestId('k-weighting-explanation')).toBeVisible();

    // Honest copy: must reference K-weighting / weight per-frequency,
    // and must NOT phrase the curve as "LUFS at frequency X".
    const explanationText = await page.getByTestId('k-weighting-explanation').innerText();
    expect(explanationText.toLowerCase()).toContain('k-weighting');
    expect(explanationText.toLowerCase()).toContain('weight');
    // Sanity: do not assert it's a per-frequency LUFS reading.
    expect(explanationText.toLowerCase()).not.toContain('lufs at frequency');

    // Close via the Close button.
    await page.getByTestId('k-weighting-modal-close').click();
    await expect(page.getByTestId('k-weighting-modal')).toHaveCount(0);

    // Re-open and close via Escape.
    await kButton.click();
    await expect(page.getByTestId('k-weighting-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('k-weighting-modal')).toHaveCount(0);

    // The mastering analysis modal should still be open underneath.
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
