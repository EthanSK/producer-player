/**
 * Regression: bug fix 2026-04-18 (Task 4)
 *
 * When the checklist has enough items to overflow the scroll region and the
 * user adds a new item, the newly-added row should scroll into view. This is
 * a minimum-viable proof — seed 25 items to overflow the container, add one
 * more via the composer + Enter, assert the new row's bottom is within the
 * scroll region's viewport.
 */
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('adding a checklist item scrolls the list to the bottom', async () => {
  const dirs = await createE2ETestDirectories('checklist-scrolls-to-bottom-on-add');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Scroll Song v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
  ]);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link folder -> one song row.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 2. Seed 25 checklist items so the list overflows the scroll region.
    //    Stored newest-first; rendered chronologically. The exact ordering
    //    doesn't matter for this test — only that they exist.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-song-id]');
      const songId = rows[0]?.getAttribute('data-song-id');
      if (!songId) return;
      const items = [];
      // Newest (top of storage) to oldest (bottom of storage); renders
      // reverse so "item-01" appears at the chronological top.
      for (let n = 25; n >= 1; n--) {
        const label = String(n).padStart(2, '0');
        items.push({
          id: `seed-item-${label}`,
          text: `Seed item ${label}`,
          completed: false,
          timestampSeconds: n,
          versionNumber: 1,
        });
      }
      window.localStorage.setItem(
        'producer-player.song-checklists.v1',
        JSON.stringify({ [songId]: items }),
      );
    });
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 3. Open the checklist modal and confirm the seeded rows rendered.
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await expect(page.getByTestId('song-checklist-item-row')).toHaveCount(25);

    // 4. Scroll the container to the top so we can observe the scroll-to-
    //    bottom behaviour (rather than it already being there).
    const scrollRegion = page.getByTestId('song-checklist-scroll-region');
    await scrollRegion.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
    });
    const initialScrollTop = await scrollRegion.evaluate(
      (el) => (el as HTMLElement).scrollTop,
    );
    expect(initialScrollTop).toBe(0);

    // 5. Type a new item into the composer and press Enter.
    const composer = page.getByTestId('song-checklist-input');
    await composer.click();
    await composer.fill('Freshly added row');
    await composer.press('Enter');

    // 6. The new row should exist as the 26th item and be visible within the
    //    scroll region's viewport — i.e. its bottom should fall within the
    //    scroll region's client rect (give or take a pixel for borders).
    await expect(page.getByTestId('song-checklist-item-row')).toHaveCount(26);

    // Allow the double-rAF scroll effect to settle. The effect watches
    // checklistModalItemsChronological.length and dispatches the scroll via
    // two nested requestAnimationFrames, so a short wait here is harmless.
    await page.waitForTimeout(300);

    await expect
      .poll(
        async () =>
          scrollRegion.evaluate((el) => {
            const region = el as HTMLElement;
            const regionRect = region.getBoundingClientRect();
            const rows = region.querySelectorAll<HTMLElement>(
              '[data-testid="song-checklist-item-row"]',
            );
            const lastRow = rows[rows.length - 1];
            if (!lastRow) return { rowBottom: null, regionBottom: null };
            const rowRect = lastRow.getBoundingClientRect();
            return { rowBottom: rowRect.bottom, regionBottom: regionRect.bottom };
          }),
        { timeout: 5_000, intervals: [100] },
      )
      .toMatchObject({});

    const measurement = await scrollRegion.evaluate((el) => {
      const region = el as HTMLElement;
      const regionRect = region.getBoundingClientRect();
      const rowsList = region.querySelectorAll<HTMLElement>(
        '[data-testid="song-checklist-item-row"]',
      );
      const lastRow = rowsList[rowsList.length - 1];
      if (!lastRow) return null;
      const rowRect = lastRow.getBoundingClientRect();
      return {
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        regionTop: regionRect.top,
        regionBottom: regionRect.bottom,
        scrollTop: region.scrollTop,
        scrollHeight: region.scrollHeight,
        clientHeight: region.clientHeight,
      };
    });

    expect(measurement).not.toBeNull();
    if (!measurement) throw new Error('No measurement');

    // The new row's top must be at/above the region's bottom and its bottom
    // must be within (or very near) the region's visible area — a strict
    // "is visible" assertion.
    expect(measurement.rowTop).toBeLessThanOrEqual(measurement.regionBottom);
    // Tolerate <=2px of sub-pixel / scrollbar overlap.
    expect(measurement.rowBottom - measurement.regionBottom).toBeLessThanOrEqual(2);

    // Sanity: we should have genuinely scrolled away from 0.
    expect(measurement.scrollTop).toBeGreaterThan(0);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
