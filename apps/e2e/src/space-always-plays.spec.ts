/**
 * Regression: bug fix 2026-04-18
 *
 * Before this fix, pressing Space while a <button> was focused
 * activated THAT button (the browser's default Space-clicks-button
 * behavior) instead of toggling play/pause. This was especially
 * noticeable in the mastering full-screen view: after clicking the
 * floating mix/reference widget's "Mix" or "Reference" buttons, that
 * button kept focus and the next Space press re-toggled the mode
 * instead of pausing playback.
 *
 * Expected behavior: Space ALWAYS toggles play/pause. The ONLY
 * exceptions are text-entry elements (<input type=text/search/etc>,
 * <textarea>, and contentEditable), where Space must still produce a
 * literal space character.
 *
 * Scenarios covered:
 *   A. Mastering full-screen open, focus a floating widget button
 *      → Space toggles play/pause (not the focused button).
 *   B. Focus a text input → Space inserts a literal space and does
 *      NOT toggle play/pause.
 *   C. Non-mastering context: focus any button in the main UI
 *      → Space toggles play/pause.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number; sampleRate?: number } = {}
): Promise<void> {
  const sampleRate = options.sampleRate ?? 44_100;
  const durationMs = options.durationMs ?? 8_000;
  const frequencyHz = options.frequencyHz ?? 440;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
    const value = Math.max(-1, Math.min(1, sample)) * 0.36;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function linkFixtureFolder(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  fixtureDirectory: string
): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

async function cueSongVersion(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  songTitle: string,
  fileName: string
): Promise<void> {
  await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
  await page
    .getByTestId('inspector-version-row')
    .filter({ hasText: fileName })
    .getByRole('button', { name: 'Cue' })
    .click();
  await expect(page.getByTestId('player-track-name')).toContainText(fileName);
}

test.describe('Space always toggles play/pause, never activates focused button', () => {
  test('mastering full-screen: Space on focused floating mix button toggles play/pause', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-space-mastering-focused-button'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Space Test v1.wav'), {
      durationMs: 12_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Space Test', 'Space Test v1.wav');

      // Open the full-screen mastering workspace.
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      // The floating mix/reference widget only renders when a reference
      // track is loaded. Use the floating play-toggle in the mastering
      // playback float as a stand-in focus target that lives in the
      // same overlay and is a <button> — same browser-default Space
      // behavior applies.
      const overlayPlayToggle = page.getByTestId('analysis-overlay-play-toggle');
      await expect(overlayPlayToggle).toBeVisible();

      // Baseline: nothing is playing yet.
      await expect(overlayPlayToggle).toHaveAttribute('data-playing', 'false');

      // Focus the button directly (do NOT click — clicking would
      // toggle play/pause via the onClick and pollute the baseline).
      await overlayPlayToggle.focus();
      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.getAttribute(
                'data-testid'
              ) ?? null
          )
        )
        .toBe('analysis-overlay-play-toggle');

      // Press Space: expect play to START toggling (false -> true).
      await page.keyboard.press('Space');
      await expect(overlayPlayToggle).toHaveAttribute('data-playing', 'true');

      // The button should still be focused (we never stole focus) but
      // the keydown listener should have intercepted the event.
      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.getAttribute(
                'data-testid'
              ) ?? null
          )
        )
        .toBe('analysis-overlay-play-toggle');

      // Press Space again: play should toggle back to paused.
      await page.keyboard.press('Space');
      await expect(overlayPlayToggle).toHaveAttribute('data-playing', 'false');

      // Now verify the same rule holds for a NON-playback button in
      // the overlay (the "Reset session" button). Before the fix,
      // pressing Space with this button focused would have clicked it
      // and reset the session instead of toggling playback.
      const resetSessionButton = page.getByTestId('analysis-overlay-reset-session');
      await resetSessionButton.focus();
      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.getAttribute(
                'data-testid'
              ) ?? null
          )
        )
        .toBe('analysis-overlay-reset-session');

      await page.keyboard.press('Space');
      await expect(overlayPlayToggle).toHaveAttribute('data-playing', 'true');
      // Mastering overlay should still be open — Reset session was NOT
      // activated.
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('text input receives literal space and does NOT toggle play/pause', async () => {
    const directories = await createE2ETestDirectories('producer-player-space-text-input');
    await writeTestWav(path.join(directories.fixtureDirectory, 'Space Test v1.wav'), {
      durationMs: 12_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Space Test', 'Space Test v1.wav');

      const transportToggle = page.getByTestId('player-play-toggle');
      const wasPlayingBefore =
        (await transportToggle.getAttribute('aria-label')) === 'Pause';

      // Open the checklist modal to get a real text input.
      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const input = page.getByTestId('song-checklist-input');
      await input.focus();
      await input.fill('hello');
      await page.keyboard.press('Space');
      await page.keyboard.type('world');

      // The input should now contain "hello world" — a literal space
      // landed in the field.
      await expect(input).toHaveValue('hello world');

      // Playback state must be unchanged.
      const isPlayingAfter =
        (await transportToggle.getAttribute('aria-label')) === 'Pause';
      expect(isPlayingAfter).toBe(wasPlayingBefore);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('non-mastering context: Space on focused main transport button toggles play/pause', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-space-non-mastering-button'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Space Test v1.wav'), {
      durationMs: 12_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Space Test', 'Space Test v1.wav');

      // Focus a non-play button: the checklist button in the main
      // transport. Before the fix, Space with this button focused
      // would have clicked it and opened the checklist modal instead
      // of toggling playback.
      const checklistButton = page.getByTestId('transport-checklist-button');
      await checklistButton.focus();

      const transportToggle = page.getByTestId('player-play-toggle');
      await expect(transportToggle).toHaveAttribute('aria-label', 'Play');

      await page.keyboard.press('Space');
      await expect(transportToggle).toHaveAttribute('aria-label', 'Pause');

      // The checklist modal should NOT have opened.
      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);

      // Press Space again on the same still-focused button: play
      // toggles back off.
      await page.keyboard.press('Space');
      await expect(transportToggle).toHaveAttribute('aria-label', 'Play');
      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
