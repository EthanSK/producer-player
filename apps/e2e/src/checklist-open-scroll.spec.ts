/**
 * Voice 83367 (2026-05-26): opening a long song checklist should start at
 * the first outstanding item, not at the top of a long resolved backlog.
 *
 * The storage order is newest-first, while the UI renders chronologically.
 * This test seeds many completed rows before the first open todo, opens the
 * modal, and asserts that the first open todo is aligned to the top of the
 * scroll viewport.
 */
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('opening the checklist scrolls the first outstanding item to the top', async () => {
  const dirs = await createE2ETestDirectories('checklist-open-first-outstanding');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    {
      relativePath: 'Outstanding Scroll Song v1.wav',
      modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
  ]);

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

    await page.evaluate(() => {
      const row = document.querySelector('[data-song-id]');
      const songId = row?.getAttribute('data-song-id');
      if (!songId) return;

      const storedNewestFirst = [];
      for (let n = 50; n >= 1; n -= 1) {
        const label = String(n).padStart(2, '0');
        storedNewestFirst.push({
          id: 'seed-item-' + label,
          text:
            n <= 30
              ? 'Already resolved context ' + label
              : 'Outstanding work item ' + label,
          completed: n <= 30,
          timestampSeconds: n,
          versionNumber: 1,
        });
      }

      window.localStorage.setItem(
        'producer-player.song-checklists.v1',
        JSON.stringify({ [songId]: storedNewestFirst }),
      );
    });

    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await expect(page.getByTestId('song-checklist-item-row')).toHaveCount(50);

    const scrollRegion = page.getByTestId('song-checklist-scroll-region');
    await expect
      .poll(
        async () =>
          scrollRegion.evaluate((node) => {
            const region = node as HTMLElement;
            const target = region.querySelector<HTMLElement>('[data-item-id="seed-item-31"]');
            if (!target) {
              return false;
            }

            const regionRect = region.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const topDelta = targetRect.top - regionRect.top;
            return region.scrollTop > 0 && Math.abs(topDelta) <= 8;
          }),
        { timeout: 5_000, intervals: [100] },
      )
      .toBe(true);

    const measurement = await scrollRegion.evaluate((node) => {
      const region = node as HTMLElement;
      const target = region.querySelector<HTMLElement>('[data-item-id="seed-item-31"]');
      if (!target) return null;
      const regionRect = region.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return {
        scrollTop: region.scrollTop,
        topDelta: targetRect.top - regionRect.top,
      };
    });

    expect(measurement).not.toBeNull();
    if (!measurement) throw new Error('Missing outstanding row measurement');
    expect(measurement.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(measurement.topDelta)).toBeLessThanOrEqual(8);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
