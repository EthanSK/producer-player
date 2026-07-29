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

async function writeTestWav(
  filePath: string,
  options: { durationMs?: number; frequencyHz?: number } = {}
): Promise<void> {
  // Default to a tiny 0.5s sine — just enough that ffmpeg actually has
  // audio to analyze. Individual playback-sensitive tests can request a
  // longer duration so the transport does not naturally finish mid-assertion.
  const sampleRate = 44_100;
  const durationMs = options.durationMs ?? 500;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.38;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

interface QueueDump {
  active: number;
  pending: number;
  activeByPriority: { user: number; neighbor: number; background: number };
  pendingByPriority: { user: number; neighbor: number; background: number };
  totalEnqueuedByPriority: { user: number; neighbor: number; background: number };
}

type WarmupState = Array<{
  fileName: string;
  measuredReady: boolean;
  fullyEnriched: boolean;
}>;

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

async function readVisibleWarmupState(page: import('@playwright/test').Page): Promise<WarmupState> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __producerPlayerGetVisibleLatestWarmupState?: () => WarmupState;
      }
    ).__producerPlayerGetVisibleLatestWarmupState?.();
    if (!state) {
      throw new Error('__producerPlayerGetVisibleLatestWarmupState not exposed yet');
    }
    return state;
  }) as Promise<WarmupState>;
}

async function readLibraryWarmupState(page: import('@playwright/test').Page): Promise<WarmupState> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __producerPlayerGetLibraryLatestWarmupState?: () => WarmupState;
      }
    ).__producerPlayerGetLibraryLatestWarmupState?.();
    if (!state) {
      throw new Error('__producerPlayerGetLibraryLatestWarmupState not exposed yet');
    }
    return state;
  }) as Promise<WarmupState>;
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

  test('version-history analysis waits behind visible main-list LUFS on cold open @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-bg-tasks-version-history-priority'
    );

    // Alpha has old versions, so the Inspector's Version History has real work
    // to do. Write Alpha last so its latest v3 file is the initially-selected
    // row; Bravo/Charlie prove that the visible main-list LUFS pass still gets
    // priority across all current track rows before those old Alpha versions
    // start spending measured-analysis slots.
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Bravo Track v1.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Charlie Track v1.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Alpha Track v1.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Alpha Track v2.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Alpha Track v3.wav')
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory,
      {
        extraEnv: {
          PRODUCER_PLAYER_ANALYSIS_DELAY_MS: '900',
        },
      }
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

      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerGetMeasuredQueueDump?: () => unknown;
              __producerPlayerGetVisibleLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerGetMeasuredQueueDump === 'function' &&
          typeof (
            window as unknown as {
              __producerPlayerGetVisibleLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerGetVisibleLatestWarmupState === 'function',
        null,
        { timeout: 10_000 }
      );

      await expect
        .poll(async () => (await readMeasuredQueueDump(page)).activeByPriority.neighbor, {
          timeout: 8_000,
        })
        .toBeGreaterThan(0);

      const dumpWhileVisibleRowsStillWarm = await readMeasuredQueueDump(page);
      const visibleStateWhileWarm = await readVisibleWarmupState(page);
      expect(visibleStateWhileWarm.some((entry) => !entry.measuredReady)).toBe(true);
      expect(dumpWhileVisibleRowsStillWarm.activeByPriority.background).toBe(0);
      expect(dumpWhileVisibleRowsStillWarm.pendingByPriority.background).toBe(0);
      expect(dumpWhileVisibleRowsStillWarm.totalEnqueuedByPriority.background).toBe(0);

      await expect
        .poll(async () => {
          const state = await readVisibleWarmupState(page);
          return state.every((entry) => entry.measuredReady);
        }, { timeout: 20_000 })
        .toBe(true);

      await expect
        .poll(async () => (await readMeasuredQueueDump(page)).totalEnqueuedByPriority.background, {
          timeout: 8_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('visible latest export warms LUFS gently during playback @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-bg-tasks-new-version-during-playback'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'NewVersion Alpha v1.wav'),
      { durationMs: 15_000, frequencyHz: 440 }
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'NewVersion Bravo v1.wav')
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );

    try {
      await page.addStyleTag({
        content: `
          /*
           * This regression is about background LUFS warmup, not Producey Boy.
           * On narrow CI viewports the first-launch agent panel can auto-open
           * after the warmup wait and sit above the track row, turning a product
           * regression test into a pointer-interception test.
           */
          [data-testid="agent-chat-panel"] {
            pointer-events: none !important;
          }
        `,
      });

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
              __producerPlayerGetVisibleLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerGetVisibleLatestWarmupState === 'function',
        null,
        { timeout: 10_000 }
      );

      await expect
        .poll(async () => {
          const state = await readVisibleWarmupState(page);
          return state.every((entry) => entry.measuredReady);
        }, { timeout: 30_000, intervals: [250, 500, 1000] })
        .toBe(true);

      const alphaRow = page.getByTestId('main-list-row').filter({ hasText: 'NewVersion Alpha' }).first();
      await alphaRow.click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('NewVersion Alpha');
      });
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.evaluate(() => {
        const target = window as unknown as {
          __producerPlayerClearPlaybackEventLog?: () => void;
        };
        target.__producerPlayerClearPlaybackEventLog?.();
      });

      // Simulate the real watched-folder path: a fresh bounce lands while the
      // older version is still playing. The top-level row should finish its
      // low-priority loudness-only pass without changing transport intent.
      await writeTestWav(
        path.join(directories.fixtureDirectory, 'NewVersion Alpha v2.wav'),
        { durationMs: 15_000, frequencyHz: 520 }
      );
      await writeTestWav(
        path.join(directories.fixtureDirectory, 'NewVersion Bravo v2.wav'),
        { durationMs: 15_000, frequencyHz: 620 }
      );
      await page.getByTestId('rescan-button').click();

      // The rescan intentionally hands the selected song from v1 to the new
      // latest v2 source. Ignore that source-change buffering and observe
      // continuity only after v2 has actually started playing.
      await expect
        .poll(async () => {
          const events = await page.evaluate(() => {
            const target = window as unknown as {
              __producerPlayerGetPlaybackEventLog?: () => Array<{
                event: string;
                selectedFilePath?: string;
              }>;
            };
            return target.__producerPlayerGetPlaybackEventLog?.() ?? [];
          });
          return events.some(
            (entry) =>
              entry.event === 'playing' &&
              entry.selectedFilePath?.endsWith('NewVersion Alpha v2.wav')
          );
        }, { timeout: 10_000 })
        .toBe(true);
      const playbackAfterHandoffSeconds = await page.evaluate(() => {
        const target = window as unknown as {
          __producerPlayerClearPlaybackEventLog?: () => void;
          __producerPlayerGetPlaybackHandoffState?: () => {
            currentAudioTimeSeconds: number | null;
          };
        };
        target.__producerPlayerClearPlaybackEventLog?.();
        return target.__producerPlayerGetPlaybackHandoffState?.().currentAudioTimeSeconds ?? 0;
      });

      await expect
        .poll(async () => {
          const state = await readVisibleWarmupState(page);
          return state.some((entry) => entry.fileName === 'NewVersion Alpha v2.wav');
        }, { timeout: 10_000 })
        .toBe(true);
      await expect(alphaRow.getByTestId('main-list-row-integrated-lufs')).not.toContainText(
        'Loading',
        { timeout: 30_000 }
      );
      await expect(alphaRow.getByTestId('main-list-row-integrated-lufs')).toHaveAttribute(
        'data-status',
        'ready'
      );
      await expect(alphaRow.getByTestId('main-list-row-duration')).not.toContainText(
        'Loading'
      );
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      const playbackEvidence = await page.evaluate(() => {
        const target = window as unknown as {
          __producerPlayerGetPlaybackEventLog?: () => Array<{ event: string }>;
          __producerPlayerGetPlaybackHandoffState?: () => {
            currentAudioTimeSeconds: number | null;
          };
        };
        return {
          currentAudioTimeSeconds:
            target.__producerPlayerGetPlaybackHandoffState?.().currentAudioTimeSeconds ?? 0,
          events: target.__producerPlayerGetPlaybackEventLog?.() ?? [],
        };
      });
      expect(playbackEvidence.currentAudioTimeSeconds).toBeGreaterThan(
        playbackAfterHandoffSeconds + 0.1
      );
      expect(
        playbackEvidence.events.filter(
          ({ event }) => event === 'waiting' || event === 'stalled'
        )
      ).toEqual([]);
      expect(
        (await readLibraryWarmupState(page)).find(
          (entry) => entry.fileName === 'NewVersion Bravo v2.wav'
        )?.measuredReady ?? false
      ).toBe(false);

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');
      await expect
        .poll(async () => {
          const state = await readVisibleWarmupState(page);
          return state.find((entry) => entry.fileName === 'NewVersion Alpha v2.wav')
            ?.fullyEnriched ?? false;
        }, { timeout: 30_000 })
        .toBe(true);
      await expect
        .poll(async () => {
          const state = await readLibraryWarmupState(page);
          return state.find((entry) => entry.fileName === 'NewVersion Bravo v2.wav')
            ?.fullyEnriched ?? false;
        }, { timeout: 30_000 })
        .toBe(true);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
