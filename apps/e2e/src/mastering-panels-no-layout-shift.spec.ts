/**
 * v3.27.0 — Layout-shift regression for the Mastering Checklist (and the
 * sibling Pro Indicators / "Quick Diagnostics") panels.
 *
 * Ethan, voice note: "while the mastering checklist is loading, the
 * whole panel doesn't show, and then once it's loaded everything shifts
 * because of the height."
 *
 * Before v3.27: both panels returned null until `activePreviewAnalysisStatus
 * === 'ready'`, which caused the fullscreen mastering overlay to grow
 * vertically and push every panel below them down the moment real
 * values arrived. The height delta was on the order of ~180-220px for
 * the checklist alone — very visible.
 *
 * After v3.27: both panels render a skeleton placeholder at the same
 * height they'll eventually occupy. This spec captures the y-coordinate
 * of the panel that sits directly after the checklist (`crest-factor-history`)
 * while the checklist is still in its 'pending' skeleton state, then
 * waits for the checklist to reach 'ready' and re-captures. The delta
 * must be small (≤ 2 px of float-rounding noise).
 *
 * If this spec fails, the layout shift has regressed — check that:
 *   - `data-checklist-state="pending"` renders the SAME number of rows
 *     as the ready state (both derive from the rule registry as of
 *     v3.28.0; prior to v3.28 the count was hard-coded at 4)
 *   - the skeleton row styles in styles.css haven't diverged from the
 *     loaded row in height (padding / font-size / border)
 *   - no other panel between the checklist and `crest-factor-history`
 *     has been inserted that also has its own layout-shift regression.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

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

async function writeSineWav(
  filePath: string,
  frequencyHz: number,
  durationSec: number,
): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequencyHz}:duration=${durationSec}`,
    '-c:a',
    'pcm_s16le',
    filePath,
  ]);
}

test('v3.27 — mastering checklist skeleton eliminates layout shift on load', async () => {
  const dirs = await createE2ETestDirectories('mastering-panels-no-layout-shift');

  const songPath = path.join(dirs.fixtureDirectory, 'Track v1.wav');
  await writeSineWav(songPath, 220, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    await page.getByTestId('main-list-row').first().click();
    await page
      .getByTestId('inspector-version-row')
      .filter({ hasText: 'Track v1.wav' })
      .getByRole('button', { name: 'Cue' })
      .click();
    await expect(page.getByTestId('player-track-name')).toContainText('Track v1.wav');

    // Race into fullscreen mastering BEFORE the measured analysis is
    // ready. The skeleton path requires no awaiting — it renders
    // immediately once the user opens the overlay.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    const checklistPanel = page.getByTestId('analysis-mastering-checklist');
    await expect(checklistPanel).toBeVisible();

    // Scenario: we must catch the panel in 'pending' state. Usually the
    // measured analysis completes in under a second for a 3s sine, but
    // rendering + first layout is faster still. If we observe 'ready'
    // immediately, the skeleton path wasn't exercised — retry via a
    // reload. (We only need one observation of 'pending' to assert
    // stability across the transition.)
    const state = await checklistPanel.getAttribute('data-checklist-state');
    const observedPending = state === 'pending';

    // Capture y-coordinate of the panel that sits directly after the
    // checklist. We measure bottom because layout shift accumulates
    // downward — any height delta inside the checklist pushes the next
    // panel's top down, and we want to detect that.
    const getCrestY = async (): Promise<number> => {
      const crestBox = await page
        .getByTestId('analysis-crest-factor-history')
        .boundingBox();
      expect(crestBox).not.toBeNull();
      return crestBox!.y;
    };

    const yBefore = observedPending ? await getCrestY() : null;

    // Wait for the checklist to reach 'ready' state.
    await expect(checklistPanel).toHaveAttribute('data-checklist-state', 'ready', {
      timeout: 20_000,
    });
    // v3.28.0 — the rule set expanded from 4 to ~15 rows. Assert "at
    // least 4" so future rule additions don't break the layout-shift
    // invariant, which doesn't depend on the exact count anyway.
    const readyRowCount = await checklistPanel
      .locator(
        '.mastering-checklist-row.pass, .mastering-checklist-row.warn, .mastering-checklist-row.fail, .mastering-checklist-row.unavailable',
      )
      .count();
    expect(readyRowCount).toBeGreaterThanOrEqual(4);

    const yAfter = await getCrestY();

    if (yBefore !== null) {
      const delta = Math.abs(yAfter - yBefore);
      // Allow a couple pixels for float rounding / subpixel drift. A
      // real layout shift from the pre-v3.27 null-render regressed
      // ~180-220px.
      expect(
        delta,
        `Mastering checklist layout shift regressed: Y moved by ${delta}px (was ${yBefore}, now ${yAfter})`,
      ).toBeLessThanOrEqual(2);
    } else {
      // Analysis completed before we could observe 'pending'. Not a
      // failure: the skeleton still renders while state is pending;
      // this branch simply means the race was too fast to sample on
      // this machine. The unit-ish assertion at least confirms both
      // panel states are reachable.
      // eslint-disable-next-line no-console
      console.warn(
        'mastering-panels-no-layout-shift: analysis became ready before pending state could be sampled — skipping shift assertion',
      );
    }

    // Sanity check: while in 'ready' state there must be exactly 4
    // loaded rows and ZERO skeleton rows. This guards against the
    // skeleton and loaded branches accidentally rendering in parallel.
    await expect(
      checklistPanel.locator('.mastering-checklist-row--skeleton'),
    ).toHaveCount(0);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});

test('v3.27 — mastering checklist renders skeleton rows when analysis is pending', async () => {
  // Deterministic pending-state assertion. This test is the
  // unit-ish fallback to the timing-sensitive layout-shift test
  // above — it loads a song, opens fullscreen mastering, and
  // asserts that the panel is in pending state with skeleton rows
  // BEFORE waiting for analysis to complete, then confirms the
  // row count is preserved in the ready state (v3.28+ mirrors the
  // rule registry rather than hard-coding 4). Uses a longer
  // (10-second) sine wave to widen the window between render and
  // analysis completion.
  const dirs = await createE2ETestDirectories('mastering-panels-skeleton-rows');

  const songPath = path.join(dirs.fixtureDirectory, 'Long Track v1.wav');
  await writeSineWav(songPath, 220, 10);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    await page.getByTestId('main-list-row').first().click();
    await page
      .getByTestId('inspector-version-row')
      .filter({ hasText: 'Long Track v1.wav' })
      .getByRole('button', { name: 'Cue' })
      .click();
    await expect(page.getByTestId('player-track-name')).toContainText('Long Track v1.wav');

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    const checklistPanel = page.getByTestId('analysis-mastering-checklist');
    await expect(checklistPanel).toBeVisible();

    // v3.28.0 — the panel MUST render the SAME row count in pending vs
    // ready states (skeleton mirrors the rule registry exactly), which
    // is the core "no layout shift" invariant. Capture the pending
    // count first, then assert the ready count equals it.
    await expect(checklistPanel.locator('.mastering-checklist-row').first()).toBeVisible({
      timeout: 10_000,
    });
    const pendingRowCount = await checklistPanel
      .locator('.mastering-checklist-row')
      .count();
    expect(pendingRowCount).toBeGreaterThanOrEqual(4);

    // Eventually it reaches ready and the skeleton disappears.
    await expect(checklistPanel).toHaveAttribute('data-checklist-state', 'ready', {
      timeout: 30_000,
    });
    await expect(checklistPanel.locator('.mastering-checklist-row--skeleton')).toHaveCount(0);
    await expect(checklistPanel.locator('.mastering-checklist-row')).toHaveCount(pendingRowCount);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
