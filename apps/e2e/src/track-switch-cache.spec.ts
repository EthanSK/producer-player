import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchProducerPlayer } from './helpers/electron-app';

// Item #10 (v3.110) — track-switch precompute / cache.
//
// These tests pin down the *user-felt* invariant of the precompute layer:
// once the album-active-version preload has run, switching to a previously
// selected track must come back from cache without re-running ffmpeg. We
// verify this two ways:
//   1. After selecting two tracks in turn, the persisted mastering-analysis
//      cache (`getMasteringAnalysisCache()` IPC) contains entries for every
//      active version of every song in the album — proof that the
//      background preload pool fanned the work out concurrently and
//      finished within a sensible bound.
//   2. After re-selecting an already-analyzed track, the analysisStatus
//      surfaces 'ready' synchronously (no 'loading' flash at all).
//
// The pool is a renderer-side concern; the cache is a main-process JSON file
// keyed by filePath + sizeBytes + modifiedAtMs. Both layers cooperate to make
// rapid track switching feel instant.

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
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

  test('background preload populates the album cache and re-selection is instant', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-track-switch-cache-user-')
    );

    // Three tiny real-WAV fixtures so ffmpeg ebur128 has signal to chew on.
    // Short duration keeps each analysis deterministic and fast.
    const fixtureNames = ['Alpha v1.wav', 'Bravo v1.wav', 'Charlie v1.wav'];
    const frequencies = [330, 440, 550];
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

      // Wait for the background-preload pool to drain the rest of the album.
      // We poll the persisted mastering cache directly — that's what the
      // preload effect writes to via upsertMasteringCacheEntry. Three tracks,
      // concurrency-2 pool, 2-second sine waves, ffmpeg ebur128 ~0.3s each
      // ⇒ generous 60s budget keeps CI runners happy.
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

      // Re-select the first track (Alpha) and assert analysisStatus does
      // NOT pass through 'loading' — should land directly on 'ready' from
      // the in-memory cache. We sample several React frames to give any
      // accidental loading state a chance to appear.
      await page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Bravo' })
        .first()
        .click();
      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText(
        'Loading',
        { timeout: 15_000 }
      );

      // Now jump back to Alpha and verify it's instant (no loading flash).
      const alphaRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Alpha' })
        .first();
      await alphaRow.click();

      // Sample the integrated-stat element across ~10 microticks. If the
      // cache hit worked, none of those samples should ever say "Loading".
      const sawLoading = await page.evaluate(async () => {
        const start = performance.now();
        let observedLoading = false;
        const deadline = start + 250;
        while (performance.now() < deadline) {
          const el = document.querySelector('[data-testid="analysis-integrated-stat"]');
          const text = el?.textContent ?? '';
          if (/loading/i.test(text)) {
            observedLoading = true;
            break;
          }
          // eslint-disable-next-line no-await-in-loop -- intentional sampling
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        return observedLoading;
      });
      expect(sawLoading, 'cache hit should never flash "Loading"').toBe(false);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
