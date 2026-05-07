import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * v3.145 — the visible pause/resume control was removed from the background
 * jobs pill. A legacy persisted OFF state must be harmless: startup latest-track
 * measured warmup should still run on launch once library data is available,
 * without requiring the user to change tracks first.
 */

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

async function writeTestWav(filePath: string, frequencyHz: number): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 1_500;
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

interface WarmupState {
  songTitle: string;
  versionId: string;
  fileName: string;
  cacheKey: string;
  previewReady: boolean;
  measuredReady: boolean;
}

async function readLibraryWarmupState(page: Page): Promise<WarmupState[]> {
  return page.evaluate(() => {
    const reader = (
      window as unknown as {
        __producerPlayerGetLibraryLatestWarmupState?: () => WarmupState[];
      }
    ).__producerPlayerGetLibraryLatestWarmupState;
    if (!reader) {
      throw new Error('__producerPlayerGetLibraryLatestWarmupState not exposed yet');
    }
    return reader();
  }) as Promise<WarmupState[]>;
}

test.describe('Background tasks status jobs @smoke', () => {
  test.skip(
    !hasFfmpeg(),
    'requires the host ffmpeg binary for measured startup warmup'
  );

  test('legacy paused state has no UI toggle and does not block startup warmup @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-bg-tasks-status'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'BgStatus Alpha v1.wav'),
      330
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'BgStatus Bravo v1.wav'),
      440
    );

    await fs.writeFile(
      path.join(directories.userDataDirectory, 'producer-player-user-state.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: '2026-05-07T00:00:00.000Z',
          linkedFolders: [{ path: directories.fixtureDirectory }],
          agentBackgroundPrecomputeEnabled: false,
        },
        null,
        2
      ),
      'utf8'
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );

    try {
      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerGetLibraryLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerGetLibraryLatestWarmupState === 'function',
        null,
        { timeout: 10_000 }
      );

      await expect(page.getByTestId('main-list-row')).toHaveCount(2, {
        timeout: 15_000,
      });

      await expect(page.getByTestId('bg-tasks-indicator-toggle')).toHaveCount(0);
      const legacyHooks = await page.evaluate(() => ({
        get: typeof (
          window as unknown as {
            __producerPlayerGetBackgroundPrecomputeEnabled?: unknown;
          }
        ).__producerPlayerGetBackgroundPrecomputeEnabled,
        set: typeof (
          window as unknown as {
            __producerPlayerSetBackgroundPrecomputeEnabled?: unknown;
          }
        ).__producerPlayerSetBackgroundPrecomputeEnabled,
      }));
      expect(legacyHooks).toEqual({ get: 'undefined', set: 'undefined' });

      await expect
        .poll(
          async () => {
            const state = await readLibraryWarmupState(page);
            return {
              fileNames: state.map((entry) => entry.fileName).sort(),
              allMeasuredReady: state.every((entry) => entry.measuredReady),
              bravoMeasuredReady:
                state.find((entry) => entry.fileName === 'BgStatus Bravo v1.wav')
                  ?.measuredReady ?? false,
            };
          },
          { timeout: 45_000, intervals: [250, 500, 1000] }
        )
        .toEqual({
          fileNames: ['BgStatus Alpha v1.wav', 'BgStatus Bravo v1.wav'],
          allMeasuredReady: true,
          bravoMeasuredReady: true,
        });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
