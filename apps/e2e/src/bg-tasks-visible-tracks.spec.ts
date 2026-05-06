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
 * v3.121/v3.137 — visible-songs ordering for startup/background warmup.
 *
 * Coverage:
 *   1. Search filter collapses the visible main-list. The warmup pool keeps
 *      the visible subset first, and all latest-version startup jobs now use
 *      NEIGHBOR priority rather than leaving hidden rows as a second-tier
 *      BACKGROUND backlog.
 *   2. Clearing the search filter expands the visible set; subsequent warmup
 *      jobs cover the now-visible-again rest. We don't assert exact ordering
 *      of in-flight jobs (that's racy on slow CI) — we assert that the queue
 *      remains healthy while the visible set changes.
 *
 * Scoped to @smoke because Concern 3 is a UX correctness fix that should
 * never silently regress.
 */

async function writeTestWav(filePath: string): Promise<void> {
  // Tiny 0.5s 440 Hz sine — just enough that ffmpeg actually has audio
  // to analyze; we deliberately keep it short so CI doesn't spend time
  // measuring full-length files.
  const sampleRate = 44_100;
  const durationMs = 500;
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

interface QueueDump {
  active: number;
  pending: number;
  pendingByPriority: { user: number; neighbor: number; background: number };
  totalEnqueuedByPriority: { user: number; neighbor: number; background: number };
}

async function readMeasuredQueueDump(page: import('@playwright/test').Page): Promise<QueueDump> {
  return page.evaluate(() => {
    const dump = (
      window as unknown as {
        __producerPlayerGetMeasuredQueueDump?: () => QueueDump;
      }
    ).__producerPlayerGetMeasuredQueueDump?.();
    if (!dump) {
      throw new Error('__producerPlayerGetMeasuredQueueDump not exposed yet');
    }
    return dump;
  }) as Promise<QueueDump>;
}

test.describe('Background tasks visible-songs prioritization @smoke', () => {
  test('search filter keeps startup warmup queues healthy @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-bg-tasks-visible'
    );

    // One real WAV plus two lightweight rows is enough to exercise the
    // startup-warmup queue without making this smoke test spend time on
    // extra ffmpeg work. Filenames chosen to make the search query
    // unambiguous: only "Alpha" matches the prefix.
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Alpha Track v1.wav')
    );
    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Bravo Track v1.wav', contents: 'RIFF stub data' },
      { relativePath: 'Charlie Track v1.wav', contents: 'RIFF stub data' },
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

      await expect(page.getByTestId('main-list-row')).toHaveCount(3, {
        timeout: 15_000,
      });

      // Wait for the test hooks to be installed by the renderer.
      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerSetSearchText?: (next: string) => void;
              __producerPlayerGetMeasuredQueueDump?: () => unknown;
            }
          ).__producerPlayerSetSearchText === 'function' &&
          typeof (
            window as unknown as {
              __producerPlayerGetMeasuredQueueDump?: () => unknown;
            }
          ).__producerPlayerGetMeasuredQueueDump === 'function',
        null,
        { timeout: 10_000 }
      );

      // Filter the main-list to just "Alpha".
      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('Alpha');
      });

      await expect(page.getByTestId('main-list-row')).toHaveCount(1, {
        timeout: 5_000,
      });

      // Pick up the queue dump. The queue may already be idle (only 3 short
      // WAVs in the fixture), so we do not assert a specific dump shape. The
      // invariant is that the v3.137 startup warmup path keeps latest-version
      // jobs out of the optional BACKGROUND bucket while search filters change.
      const dumpsWhileSearching: QueueDump[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(150);
        dumpsWhileSearching.push(await readMeasuredQueueDump(page));
      }

      for (const dump of dumpsWhileSearching) {
        expect(dump.pending).toBe(
          dump.pendingByPriority.user +
            dump.pendingByPriority.neighbor +
            dump.pendingByPriority.background
        );
        expect(dump.pending).toBeLessThanOrEqual(3);
        expect(dump.pendingByPriority.background).toBe(0);
        expect(dump.totalEnqueuedByPriority.background).toBe(0);
      }

      // When we clear the search, the visible set expands to all 3
      // tracks. Subsequent enqueues should touch the previously-hidden
      // rows. Mostly this asserts that the effect re-runs and the
      // queue's `pendingByPriority` dispatch shifts as expected.
      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('');
      });

      await expect(page.getByTestId('main-list-row')).toHaveCount(3, {
        timeout: 5_000,
      });

      // Allow the queue to drain naturally; we don't assert on exact
      // ordering. The success signal is that the test reached this
      // point without the renderer freezing.
      await page.waitForTimeout(500);
      const finalDump = await readMeasuredQueueDump(page);
      expect(finalDump.pending).toBe(
        finalDump.pendingByPriority.user +
          finalDump.pendingByPriority.neighbor +
          finalDump.pendingByPriority.background
      );
      expect(finalDump.pendingByPriority.background).toBe(0);
      expect(finalDump.totalEnqueuedByPriority.background).toBe(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
