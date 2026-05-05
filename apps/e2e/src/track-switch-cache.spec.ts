import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchProducerPlayer } from './helpers/electron-app';

// Item #10 (v3.110) — track-switch precompute / cache.
//
// These tests pin down the *user-felt* invariant of the precompute layer:
// once the visible/latest-version preload has run, switching to a visible
// track must come back from cache without re-running ffmpeg or preview decode.
// We verify this two ways:
//   1. The persisted mastering-analysis cache (`getMasteringAnalysisCache()`
//      IPC) contains entries for every latest visible version — proof that
//      the measured background pool fanned the work out concurrently and
//      finished within a sensible bound.
//   2. The renderer-side visible warmup hook reports both measured+preview
//      caches ready, then a first jump to a never-selected row has no
//      synchronous 'Loading' flash.
//
// The pool is a renderer-side concern; the cache is a main-process JSON file
// keyed by filePath + sizeBytes + modifiedAtMs. Both layers cooperate to make
// rapid track switching feel instant.

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

interface VisibleWarmupState {
  songTitle: string;
  versionId: string;
  fileName: string;
  cacheKey: string;
  previewReady: boolean;
  measuredReady: boolean;
}

async function readVisibleWarmupState(
  page: import('@playwright/test').Page
): Promise<VisibleWarmupState[]> {
  return page.evaluate(() => {
    const reader = (
      window as unknown as {
        __producerPlayerGetVisibleLatestWarmupState?: () => VisibleWarmupState[];
      }
    ).__producerPlayerGetVisibleLatestWarmupState;
    if (!reader) {
      throw new Error('__producerPlayerGetVisibleLatestWarmupState not exposed yet');
    }
    return reader();
  }) as Promise<VisibleWarmupState[]>;
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

      const charlieWarmupState = await readVisibleWarmupState(page).then((state) =>
        state.find((entry) => entry.songTitle === 'Charlie') ?? null
      );
      expect(charlieWarmupState?.fileName).toBe('Charlie v2.wav');

      const charlieRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Charlie' })
        .first();
      const charlieSongId = await charlieRow.getAttribute('data-song-id');
      expect(charlieSongId).not.toBeNull();

      await charlieRow.dblclick();
      await expect(charlieRow).toHaveClass(/selected/);

      const switchObservation = await page.evaluate(
        async ({ targetSongId }) => {
          const deadline = performance.now() + 500;
          let sawTargetLatest = false;
          let lastState: {
            selectedPlaybackSongId: unknown;
            currentPlaybackVersionNumber: unknown;
            analysisStatus: unknown;
          } | null = null;

          while (performance.now() < deadline) {
            const gateState = (window as unknown as {
              __producerPlayerAutoRunGateState?: () => {
                selectedPlaybackSongId?: unknown;
                currentPlaybackVersionNumber?: unknown;
                analysisStatus?: unknown;
              };
            }).__producerPlayerAutoRunGateState?.();
            lastState = {
              selectedPlaybackSongId: gateState?.selectedPlaybackSongId ?? null,
              currentPlaybackVersionNumber: gateState?.currentPlaybackVersionNumber ?? null,
              analysisStatus: gateState?.analysisStatus ?? null,
            };

            if (lastState.selectedPlaybackSongId === targetSongId) {
              if (lastState.currentPlaybackVersionNumber !== 2) {
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
            }

            // eslint-disable-next-line no-await-in-loop -- intentional frame sampling
            await new Promise((resolve) => setTimeout(resolve, 16));
          }

          return { sawTargetLatest, notReadyStatus: null, lastState };
        },
        { targetSongId: charlieSongId }
      );
      expect(switchObservation.sawTargetLatest, 'Charlie v2 should become the playback target').toBe(
        true
      );
      expect(
        switchObservation.notReadyStatus,
        'never-selected visible latest rows should be fully prewarmed on startup'
      ).toBeNull();

    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
