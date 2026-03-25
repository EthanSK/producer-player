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
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
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

async function waitForPlaybackSeconds(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  minimumSeconds: number
): Promise<void> {
  const scrubber = page.getByTestId('player-scrubber');
  await expect
    .poll(async () => Number(await scrubber.inputValue()))
    .toBeGreaterThan(minimumSeconds);
}

test.describe('arrow key seek shortcuts', () => {
  test('right arrow seeks forward by 5 seconds', async () => {
    const directories = await createE2ETestDirectories('producer-player-arrow-seek-forward');
    await writeTestWav(path.join(directories.fixtureDirectory, 'Seek Test v1.wav'), {
      durationMs: 15_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Seek Test', 'Seek Test v1.wav');

      // Start playback and let it run briefly so we have a known position
      await page.getByTestId('transport-play-toggle').click();
      await waitForPlaybackSeconds(page, 1.0);
      await page.getByTestId('transport-play-toggle').click();

      const scrubber = page.getByTestId('player-scrubber');
      const beforeSeek = Number(await scrubber.inputValue());

      // Press Right arrow to seek forward 5 seconds
      await page.keyboard.press('ArrowRight');

      const afterSeek = Number(await scrubber.inputValue());
      expect(afterSeek).toBeGreaterThanOrEqual(beforeSeek + 4.5);
      expect(afterSeek).toBeLessThanOrEqual(beforeSeek + 5.5);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('left arrow seeks backward by 5 seconds', async () => {
    const directories = await createE2ETestDirectories('producer-player-arrow-seek-backward');
    await writeTestWav(path.join(directories.fixtureDirectory, 'Seek Test v1.wav'), {
      durationMs: 15_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Seek Test', 'Seek Test v1.wav');

      // Start playback and let it advance past 6 seconds so we can seek backward
      await page.getByTestId('transport-play-toggle').click();
      await waitForPlaybackSeconds(page, 6.5);
      await page.getByTestId('transport-play-toggle').click();

      const scrubber = page.getByTestId('player-scrubber');
      const beforeSeek = Number(await scrubber.inputValue());

      // Press Left arrow to seek backward 5 seconds
      await page.keyboard.press('ArrowLeft');

      const afterSeek = Number(await scrubber.inputValue());
      expect(afterSeek).toBeGreaterThanOrEqual(beforeSeek - 5.5);
      expect(afterSeek).toBeLessThanOrEqual(beforeSeek - 4.5);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('arrow keys do not seek when a text input is focused', async () => {
    const directories = await createE2ETestDirectories('producer-player-arrow-seek-input-guard');
    await writeTestWav(path.join(directories.fixtureDirectory, 'Seek Test v1.wav'), {
      durationMs: 15_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Seek Test', 'Seek Test v1.wav');

      // Start playback briefly to set a position
      await page.getByTestId('transport-play-toggle').click();
      await waitForPlaybackSeconds(page, 1.0);
      await page.getByTestId('transport-play-toggle').click();

      // Open checklist modal to get a text input
      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const scrubber = page.getByTestId('player-scrubber');
      const beforeSeek = Number(await scrubber.inputValue());

      // Focus the checklist text input and press arrow keys
      const checklistInput = page.getByTestId('song-checklist-input');
      await checklistInput.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');

      // Playback position should be unchanged (within small tolerance for rounding)
      const afterSeek = Number(await scrubber.inputValue());
      expect(Math.abs(afterSeek - beforeSeek)).toBeLessThan(0.5);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
