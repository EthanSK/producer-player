import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

// Regression test for: quick song switcher did not update the song shown in
// Checklist Full Screen while Mastering Full Screen updated correctly. The fix
// unifies the "currently selected song" invariant so both views follow the
// quick switcher. See apps/renderer/src/App.tsx → handleQuickSwitcherSelect.

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number; sampleRate?: number } = {}
): Promise<void> {
  const sampleRate = options.sampleRate ?? 44_100;
  const durationMs = options.durationMs ?? 4_000;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.3;
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
    await (window as typeof window & {
      producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
    }).producerPlayer.linkFolder(folderPath);
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

test.describe('quick switcher keeps checklist full screen in sync', () => {
  test('switching songs via the quick switcher updates the Checklist Full Screen body', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-quick-switcher-checklist-sync'
    );

    // Two different tracks so we can tell them apart by title in the checklist
    // header. Different frequencies keep them trivially distinct for audio.
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 3_000,
      frequencyHz: 330,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 3_000,
      frequencyHz: 550,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      // Start on Track A and open its checklist full-screen overlay.
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');
      await page.getByTestId('transport-checklist-button').click();
      const checklistModal = page.getByTestId('song-checklist-modal');
      await expect(checklistModal).toBeVisible();
      await expect(checklistModal.locator('h2')).toContainText('Track A');

      // Capture a "before" screenshot for the fix report.
      await page.screenshot({
        path: '/tmp/pp-song-selector-fix/checklist-before-track-a.png',
      });

      // Open the app-wide quick switcher and pick Track B.
      await page.getByTestId('quick-switcher-button').click();
      await expect(page.getByTestId('quick-switcher-panel')).toBeVisible();

      const trackBItem = page
        .locator('[data-testid^="quick-switcher-item-"]')
        .filter({ hasText: 'Track B' })
        .first();
      await trackBItem.click();

      // The checklist overlay stays open but now shows Track B's checklist.
      await expect(checklistModal).toBeVisible();
      await expect(checklistModal.locator('h2')).toContainText('Track B');
      await expect(checklistModal.locator('h2')).not.toContainText('Track A');

      // Playback (via Mastering state) also reflects the switch — proves the
      // unified "current song" invariant, no drift between the two views.
      await expect(page.getByTestId('player-track-name')).toContainText('Track B v1.wav');

      // Capture an "after" screenshot for the fix report.
      await page.screenshot({
        path: '/tmp/pp-song-selector-fix/checklist-after-track-b.png',
      });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
