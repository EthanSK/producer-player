import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

/**
 * v3.145 — the user-facing background pause/resume control is gone.
 *
 * Coverage:
 *   1. The old pause test hooks are no longer exposed.
 *   2. The Status jobs pill no longer renders a pause/resume toggle.
 *   3. Measured-analysis queue hooks still exist, so startup/background
 *      warmup remains observable in the Status jobs area.
 */

async function writeTestWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 1_500;
  const frequencyHz = 440;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.38;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

test.describe('Background tasks status jobs @smoke', () => {
  test('status jobs stay observable without a user-facing pause control @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-bg-tasks-status-jobs'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Status Jobs Track A v1.wav')
    );
    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Status Jobs Track B v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );

    try {
      await page.evaluate(async (folderPath) => {
        await (
          window as unknown as {
            producerPlayer: { linkFolder: (folder: string) => Promise<void> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(2, {
        timeout: 15_000,
      });

      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerGetMeasuredQueueDump?: () => unknown;
            }
          ).__producerPlayerGetMeasuredQueueDump === 'function',
        null,
        { timeout: 10_000 }
      );

      const legacyPauseHooks = await page.evaluate(() => ({
        getHook:
          typeof (
            window as unknown as {
              __producerPlayerGetBackgroundPrecomputeEnabled?: unknown;
            }
          ).__producerPlayerGetBackgroundPrecomputeEnabled,
        setHook:
          typeof (
            window as unknown as {
              __producerPlayerSetBackgroundPrecomputeEnabled?: unknown;
            }
          ).__producerPlayerSetBackgroundPrecomputeEnabled,
      }));
      expect(legacyPauseHooks).toEqual({ getHook: 'undefined', setHook: 'undefined' });

      await expect(page.getByTestId('bg-tasks-indicator-toggle')).toHaveCount(0);

      const queueDump = await page.evaluate(() =>
        (
          window as unknown as {
            __producerPlayerGetMeasuredQueueDump?: () => {
              active: number;
              pending: number;
              runningJobs: unknown[];
            };
          }
        ).__producerPlayerGetMeasuredQueueDump?.()
      );
      expect(queueDump).toBeTruthy();
      expect(Array.isArray(queueDump?.runningJobs)).toBe(true);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
