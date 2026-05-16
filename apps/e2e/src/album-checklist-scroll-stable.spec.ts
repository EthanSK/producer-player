/**
 * Regression: v3.214 (2026-05-16, voice 3103)
 *
 * The global / album checklist (opened from the album-area button above all
 * tracks) glitched when the user scrolled to the bottom of the item list —
 * the scroll position would jump back toward the top, exactly the same way
 * the per-track checklist used to misbehave before ea1d1d2.
 *
 * Root cause was the same: the textarea `ref` callback was inline
 * (`ref={(el) => { ... }}`), so every render created a new function. React
 * detaches+reattaches the ref on every commit; the autosize call runs again
 * each time; with many items the cumulative reflow visibly jostles
 * `scrollTop`. Per-track's textarea was migrated to the memoized
 * `handleChecklistItemTextareaRef` in `ea1d1d2`; the global checklist was
 * left on the inline form. v3.214 ports the same memoized ref to the global
 * checklist textarea.
 *
 * This spec is the minimum meaningful proof: open the global checklist with
 * enough items to scroll, scroll to the bottom, wheel + idle, assert
 * scrollTop does not drift back up.
 */
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('album checklist scroll-to-bottom does not jostle scroll position', async () => {
  const dirs = await createE2ETestDirectories('album-checklist-scroll-stable');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    {
      relativePath: 'Track A v1.wav',
      modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
  ]);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link a folder so the app shell renders + album area is visible.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 2. Open the album checklist (button lives in the album area, above all
    //    tracks). Then seed the items by typing + clicking the add button
    //    enough times that the scroll region overflows.
    await page.getByTestId('album-checklist-button').click();
    await expect(page.getByTestId('album-checklist-modal')).toBeVisible();

    const input = page.getByTestId('album-checklist-input');
    const addButton = page.getByTestId('album-checklist-add-button');
    for (let index = 1; index <= 40; index += 1) {
      await input.fill(`Bottom-scroll-stable check ${index}`);
      await addButton.click();
    }

    const scrollRegion = page.getByTestId('album-checklist-scroll-region');
    const scrollMetrics = await scrollRegion.evaluate((node) => ({
      scrollHeight: (node as HTMLDivElement).scrollHeight,
      clientHeight: (node as HTMLDivElement).clientHeight,
    }));
    // Sanity — we want overflow so there's room to bounce.
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight + 120);

    // 3. Jump to the bottom and idle the page for >1s. With the old inline
    //    ref the autosize re-fires on every render and the parent's
    //    scrollTop drifts back upward; with the memoized ref it stays put.
    await scrollRegion.evaluate((node) => {
      const region = node as HTMLDivElement;
      region.scrollTop = region.scrollHeight;
    });

    // Trigger a re-render by hovering items + nudging the wheel — same
    // pattern the per-track pinned-bottom test uses to surface the drift.
    await scrollRegion.hover();
    for (let index = 0; index < 5; index += 1) {
      await page.mouse.wheel(0, 360);
    }

    const drift = await scrollRegion.evaluate(async (node) => {
      const region = node as HTMLDivElement;
      const maxTop = Math.max(0, region.scrollHeight - region.clientHeight);
      let worstDistanceFromBottom = maxTop - region.scrollTop;
      const stopAt = performance.now() + 1200;

      while (performance.now() < stopAt) {
        worstDistanceFromBottom = Math.max(
          worstDistanceFromBottom,
          maxTop - region.scrollTop,
        );
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      return {
        maxTop,
        worstDistanceFromBottom,
        finalDistanceFromBottom: maxTop - region.scrollTop,
      };
    });

    expect(drift.maxTop).toBeGreaterThan(100);
    // With inline ref the drift was hundreds of pixels per second; the
    // 14-pixel threshold matches the per-track pinned-bottom test.
    expect(drift.worstDistanceFromBottom).toBeLessThan(14);
    expect(drift.finalDistanceFromBottom).toBeLessThan(14);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
