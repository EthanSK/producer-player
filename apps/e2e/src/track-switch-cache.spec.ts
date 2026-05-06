import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchProducerPlayer } from './helpers/electron-app';

// Item #10 (v3.110) — track-switch precompute / cache.
//
// These tests pin down the *user-felt* invariant of the precompute layer:
// once the startup latest-version warmup has run, switching to a visible,
// search-hidden, or other-folder latest track must come back from cache without
// re-running ffmpeg or preview decode.
// We verify this two ways:
//   1. The persisted mastering-analysis cache (`getMasteringAnalysisCache()`
//      IPC) contains entries for every latest linked-library version — proof that
//      the measured background pool fanned the work out concurrently and
//      finished within a sensible bound.
//   2. The renderer-side warmup hooks report both measured+preview caches
//      ready, then a first jump to a never-selected row has no
//      synchronous 'Loading' flash.
//
// The pool is a renderer-side concern; the cache is a main-process JSON file
// keyed by filePath + sizeBytes + modifiedAtMs. Both layers cooperate to make
// rapid track switching feel instant.

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

interface WarmupState {
  songTitle: string;
  versionId: string;
  fileName: string;
  cacheKey: string;
  previewReady: boolean;
  measuredReady: boolean;
}

interface QueueDump {
  active: number;
  userBypassActive: number;
  pending: number;
  pendingByPriority: { user: number; neighbor: number; background: number };
  totalEnqueuedByPriority: { user: number; neighbor: number; background: number };
}

interface AnalysisQueueSnapshot {
  preview: QueueDump;
  measured: QueueDump;
}

async function readVisibleWarmupState(page: Page): Promise<WarmupState[]> {
  return page.evaluate(() => {
    const reader = (
      window as unknown as {
        __producerPlayerGetVisibleLatestWarmupState?: () => WarmupState[];
      }
    ).__producerPlayerGetVisibleLatestWarmupState;
    if (!reader) {
      throw new Error('__producerPlayerGetVisibleLatestWarmupState not exposed yet');
    }
    return reader();
  }) as Promise<WarmupState[]>;
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

async function readAnalysisQueues(page: Page): Promise<AnalysisQueueSnapshot> {
  return page.evaluate(() => {
    const preview = (
      window as unknown as {
        __producerPlayerGetPreviewQueueDump?: () => QueueDump;
      }
    ).__producerPlayerGetPreviewQueueDump?.();
    const measured = (
      window as unknown as {
        __producerPlayerGetMeasuredQueueDump?: () => QueueDump;
      }
    ).__producerPlayerGetMeasuredQueueDump?.();
    if (!preview || !measured) {
      throw new Error('analysis queue dump hooks not exposed yet');
    }
    return { preview, measured };
  }) as Promise<AnalysisQueueSnapshot>;
}

function countQueueWork(snapshot: AnalysisQueueSnapshot): number {
  return (
    snapshot.preview.active +
    snapshot.preview.userBypassActive +
    snapshot.preview.pending +
    snapshot.measured.active +
    snapshot.measured.userBypassActive +
    snapshot.measured.pending
  );
}

async function expectStartupQueuesDrained(page: Page): Promise<void> {
  await expect
    .poll(async () => countQueueWork(await readAnalysisQueues(page)), {
      timeout: 10_000,
      intervals: [100, 250, 500],
    })
    .toBe(0);
  await expect(page.getByTestId('bg-tasks-indicator')).toHaveCount(0);
}

function countBackgroundEnqueues(snapshot: AnalysisQueueSnapshot): number {
  return (
    snapshot.preview.totalEnqueuedByPriority.background +
    snapshot.measured.totalEnqueuedByPriority.background
  );
}

async function expectDoubleClickSwitchIsInstantlyReady(
  page: Page,
  row: Locator,
  expectedVersionNumber: number,
  reason: string
): Promise<void> {
  const targetSongId = await row.getAttribute('data-song-id');
  expect(targetSongId).not.toBeNull();

  await row.dblclick();
  await expect(row).toHaveClass(/selected/);

  const switchObservation = await page.evaluate(
    async ({ targetSongId: expectedSongId, expectedVersionNumber: expectedVersion }) => {
      const deadline = performance.now() + 500;
      let sawTargetLatest = false;
      let lastState: {
        selectedPlaybackSongId: unknown;
        currentPlaybackVersionNumber: unknown;
        analysisStatus: unknown;
        analysisIsSet: unknown;
        measuredAnalysisIsSet: unknown;
      } | null = null;

      while (performance.now() < deadline) {
        const gateState = (window as unknown as {
          __producerPlayerAutoRunGateState?: () => {
            selectedPlaybackSongId?: unknown;
            currentPlaybackVersionNumber?: unknown;
            analysisStatus?: unknown;
            analysisIsSet?: unknown;
            measuredAnalysisIsSet?: unknown;
          };
        }).__producerPlayerAutoRunGateState?.();
        lastState = {
          selectedPlaybackSongId: gateState?.selectedPlaybackSongId ?? null,
          currentPlaybackVersionNumber: gateState?.currentPlaybackVersionNumber ?? null,
          analysisStatus: gateState?.analysisStatus ?? null,
          analysisIsSet: gateState?.analysisIsSet ?? null,
          measuredAnalysisIsSet: gateState?.measuredAnalysisIsSet ?? null,
        };

        if (lastState.selectedPlaybackSongId === expectedSongId) {
          if (lastState.currentPlaybackVersionNumber !== expectedVersion) {
            return {
              sawTargetLatest,
              notReadyStatus: `wrong-version:${String(
                lastState.currentPlaybackVersionNumber
              )}`,
              lastState,
            };
          }
          sawTargetLatest = true;
          if (lastState.analysisStatus !== 'ready') {
            return {
              sawTargetLatest,
              notReadyStatus: String(lastState.analysisStatus),
              lastState,
            };
          }
          if (!lastState.analysisIsSet || !lastState.measuredAnalysisIsSet) {
            return {
              sawTargetLatest,
              notReadyStatus: 'missing-in-memory-cache',
              lastState,
            };
          }
        }

        // eslint-disable-next-line no-await-in-loop -- intentional frame sampling
        await new Promise((resolve) => setTimeout(resolve, 16));
      }

      return { sawTargetLatest, notReadyStatus: null, lastState };
    },
    { targetSongId, expectedVersionNumber }
  );

  expect(switchObservation.sawTargetLatest, `${reason}: row should become playback target`).toBe(
    true
  );
  expect(switchObservation.notReadyStatus, reason).toBeNull();
}

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

test.describe('Track-switch precompute cache @smoke', () => {
  test.skip(
    !hasFfmpeg(),
    'requires the host ffmpeg binary to synthesize realistic audio fixtures'
  );

  test('startup warmup readies hidden library latest-version tracks for instant switching @smoke', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-all-')
    );
    const secondFixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-all-second-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-all-user-')
    );

    // Search hides Bravo from the selected-folder main list, and the second
    // linked folder is not selected at all. The invariant here is stronger
    // than “visible rows get warm”: every latest version in the linked library
    // should finish startup warmup into BOTH in-memory caches. Hidden/search-
    // filtered/other-folder rows must then double-click switch without a
    // Loading/Preparing flash.
    const fixtures = [
      { directory: fixtureDirectory, fileName: 'Alpha v1.wav', frequency: 330 },
      { directory: fixtureDirectory, fileName: 'Bravo v1.wav', frequency: 440 },
      { directory: secondFixtureDirectory, fileName: 'Charlie v1.wav', frequency: 550 },
      { directory: secondFixtureDirectory, fileName: 'Charlie v2.wav', frequency: 660 },
    ];
    for (const fixture of fixtures) {
      // eslint-disable-next-line no-await-in-loop -- deterministic fixture generation
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${fixture.frequency}:duration=1`,
        '-c:a',
        'pcm_s16le',
        path.join(fixture.directory, fixture.fileName),
      ]);
    }

    const modifiedTimes = new Map<string, string>([
      [path.join(fixtureDirectory, 'Alpha v1.wav'), '2026-05-05T12:00:03.000Z'],
      [path.join(fixtureDirectory, 'Bravo v1.wav'), '2026-05-05T12:00:02.000Z'],
      [path.join(secondFixtureDirectory, 'Charlie v2.wav'), '2026-05-05T12:00:01.000Z'],
      [path.join(secondFixtureDirectory, 'Charlie v1.wav'), '2026-05-05T12:00:00.000Z'],
    ]);
    for (const [filePath, timestamp] of modifiedTimes) {
      const date = new Date(timestamp);
      // eslint-disable-next-line no-await-in-loop -- deterministic fixture mtimes
      await fs.utimes(filePath, date, date);
    }

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerSetSearchText?: (next: string) => void;
              __producerPlayerGetLibraryLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerSetSearchText === 'function' &&
          typeof (
            window as unknown as {
              __producerPlayerGetLibraryLatestWarmupState?: () => unknown;
            }
          ).__producerPlayerGetLibraryLatestWarmupState === 'function',
        null,
        { timeout: 10_000 }
      );

      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('Alpha');
      });

      await page.evaluate(async ([firstFolderPath, secondFolderPath]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).producerPlayer.linkFolder(firstFolderPath);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).producerPlayer.linkFolder(secondFolderPath);
      }, [fixtureDirectory, secondFixtureDirectory]);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1, {
        timeout: 15_000,
      });

      await expect
        .poll(
          async () => {
            const state = await readLibraryWarmupState(page);
            return {
              visibleFileNames: await readVisibleWarmupState(page).then((visible) =>
                visible.map((entry) => entry.fileName).sort()
              ),
              libraryFileNames: state.map((entry) => entry.fileName).sort(),
              allPreviewReady: state.every((entry) => entry.previewReady),
              allMeasuredReady: state.every((entry) => entry.measuredReady),
            };
          },
          { timeout: 60_000, intervals: [250, 500, 1000] }
        )
        .toEqual({
          visibleFileNames: ['Alpha v1.wav'],
          libraryFileNames: ['Alpha v1.wav', 'Bravo v1.wav', 'Charlie v2.wav'],
          allPreviewReady: true,
          allMeasuredReady: true,
        });

      await expectStartupQueuesDrained(page);
      expect(
        countBackgroundEnqueues(await readAnalysisQueues(page)),
        'startup latest-track warmup should not use the optional BACKGROUND bucket'
      ).toBe(0);

      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('Bravo');
      });
      const bravoRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Bravo' })
        .first();
      await expect(bravoRow).toBeVisible();
      await expectDoubleClickSwitchIsInstantlyReady(
        page,
        bravoRow,
        1,
        'search-hidden latest row should switch from startup warmup cache'
      );

      await page.evaluate(() => {
        (
          window as unknown as {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('');
      });
      await expect(page.getByTestId('main-list-row')).toHaveCount(2, {
        timeout: 5_000,
      });
      await page.getByTestId('linked-folder-item').nth(1).click();
      const charlieRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Charlie' })
        .first();
      await expect(charlieRow).toBeVisible();
      await expectDoubleClickSwitchIsInstantlyReady(
        page,
        charlieRow,
        2,
        'other-folder latest row should switch from startup warmup cache'
      );

      await expectStartupQueuesDrained(page);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(secondFixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('startup warmup readies every visible latest-version track for instant switching', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-user-')
    );

    // Three visible songs (four tiny real-WAV fixtures because Charlie has
    // v1+v2) so ffmpeg ebur128 has signal to chew on. Short duration keeps
    // each analysis deterministic and fast.
    const fixtureNames = [
      'Alpha v1.wav',
      'Bravo v1.wav',
      'Charlie v1.wav',
      'Charlie v2.wav',
    ];
    const frequencies = [330, 440, 550, 660];
    for (let i = 0; i < fixtureNames.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential by intent
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequencies[i]}:duration=2`,
        '-c:a',
        'pcm_s16le',
        path.join(fixtureDirectory, fixtureNames[i]),
      ]);
    }

    const modifiedTimes: Record<string, string> = {
      'Alpha v1.wav': '2026-05-05T12:00:03.000Z',
      'Bravo v1.wav': '2026-05-05T12:00:02.000Z',
      'Charlie v2.wav': '2026-05-05T12:00:01.000Z',
      'Charlie v1.wav': '2026-05-05T12:00:00.000Z',
    };
    for (const [fileName, timestamp] of Object.entries(modifiedTimes)) {
      const date = new Date(timestamp);
      // eslint-disable-next-line no-await-in-loop -- deterministic fixture mtimes
      await fs.utimes(path.join(fixtureDirectory, fileName), date, date);
    }

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(3, {
        timeout: 15_000,
      });

      // Wait for the integrated-LUFS readout on the first selected song to
      // resolve — confirms the selected-track effect populated both the
      // measured and preview caches.
      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText(
        'Loading',
        { timeout: 15_000 }
      );

      // Wait for the background-preload pool to drain the visible latest
      // versions. We poll the persisted mastering cache directly — that's
      // what the preload effect writes to via upsertMasteringCacheEntry. Three
      // visible songs (one has v1+v2), concurrency-2 pool, 2-second sine waves,
      // ffmpeg ebur128 ~0.3s each ⇒ generous 60s budget keeps CI happy.
      let lastCount = 0;
      await expect
        .poll(
          async () => {
            lastCount = await page.evaluate(async () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const api = (window as any).producerPlayer;
              const state = await api.getMasteringAnalysisCache();
              return Array.isArray(state?.payload?.entries)
                ? state.payload.entries.length
                : 0;
            });
            return lastCount;
          },
          { timeout: 60_000, intervals: [500, 1000, 2000] }
        )
        .toBeGreaterThanOrEqual(3);

      // v3.128 — visible main-list rows should have their LUFS warmed in the
      // background on startup. This is the value Platform Normalization uses,
      // so clicking a row later can apply the right gain immediately.
      await expect
        .poll(
          async () =>
            page.getByTestId('main-list-row-integrated-lufs').evaluateAll((nodes) =>
              nodes.map((node) => ({
                status: node.getAttribute('data-status'),
                loading: /loading/i.test(node.textContent ?? ''),
              }))
            ),
          { timeout: 15_000, intervals: [250, 500, 1000] }
        )
        .toEqual([
          { status: 'ready', loading: false },
          { status: 'ready', loading: false },
          { status: 'ready', loading: false },
        ]);

      // v3.130 follow-up — startup warmup must cover the full selected-track
      // analysis path for every visible latest-version row, not just the
      // persisted ffmpeg/LUFS cache. Otherwise the first click on a
      // never-selected visible track still flashes "Preparing" / "Loading"
      // while the renderer decodes its preview waveform.
      await expect
        .poll(
          async () => {
            const state = await readVisibleWarmupState(page);
            return {
              fileNames: state.map((entry) => entry.fileName).sort(),
              allPreviewReady: state.every((entry) => entry.previewReady),
              allMeasuredReady: state.every((entry) => entry.measuredReady),
            };
          },
          { timeout: 60_000, intervals: [250, 500, 1000] }
        )
        .toEqual({
          fileNames: ['Alpha v1.wav', 'Bravo v1.wav', 'Charlie v2.wav'],
          allPreviewReady: true,
          allMeasuredReady: true,
        });

      await expectStartupQueuesDrained(page);

      const charlieWarmupState = await readVisibleWarmupState(page).then((state) =>
        state.find((entry) => entry.songTitle === 'Charlie') ?? null
      );
      expect(charlieWarmupState?.fileName).toBe('Charlie v2.wav');

      const charlieRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Charlie' })
        .first();
      await expectDoubleClickSwitchIsInstantlyReady(
        page,
        charlieRow,
        2,
        'never-selected visible latest rows should be fully prewarmed on startup'
      );

    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
