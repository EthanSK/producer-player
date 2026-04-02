import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Main list row layout', () => {
  test('title stretches across the top row until the version/format pill', async () => {
    const directories = await createE2ETestDirectories('producer-player-main-list-row-layout');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath:
          'An absurdly long demo song title to verify top row width usage and ellipsis behavior v6.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (
          window as typeof window & {
            producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      const firstRow = page.getByTestId('main-list-row').first();
      await expect(firstRow).toBeVisible();

      const layout = await firstRow.evaluate((rowNode) => {
        const topRow = rowNode.querySelector('.main-list-row-top');
        const title = rowNode.querySelector('[data-testid="main-list-row-title"]');
        const metadata = rowNode.querySelector('[data-testid="main-list-row-metadata"]');

        if (!(topRow instanceof HTMLElement) || !(title instanceof HTMLElement) || !(metadata instanceof HTMLElement)) {
          return null;
        }

        const topRect = topRow.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const metadataRect = metadata.getBoundingClientRect();

        const availableTitleWidth = metadataRect.left - titleRect.left;
        const fillRatio = availableTitleWidth > 0 ? titleRect.width / availableTitleWidth : 0;

        return {
          titleStartsAtRowStart: Math.abs(titleRect.left - topRect.left) <= 3,
          metadataStaysRightAligned: Math.abs(metadataRect.right - topRect.right) <= 3,
          titleStopsAtMetadata: titleRect.right <= metadataRect.left + 1,
          titleFillRatio: fillRatio,
        };
      });

      expect(layout).not.toBeNull();
      expect(layout?.titleStartsAtRowStart).toBe(true);
      expect(layout?.metadataStaysRightAligned).toBe(true);
      expect(layout?.titleStopsAtMetadata).toBe(true);
      expect(layout?.titleFillRatio ?? 0).toBeGreaterThan(0.85);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
