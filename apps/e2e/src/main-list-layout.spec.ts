import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Main list row layout', () => {
  // v3.108 — version capsule moved from the top-right of the row down to
  // the bottom row (replacing the plain "N versions" text). The top row
  // now contains: <title> ... <integrated-LUFS pill>. The bottom row
  // contains: <version·format pill | "Matched versions" text> ...
  // <project / checklist / date footer>. The title still stretches to
  // fill the available top-row space, but the right-side companion is
  // now the LUFS pill, not the metadata pill.
  test('title stretches across the top row until the LUFS pill, and the V·format pill renders in the bottom row', async () => {
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
        const bottomRow = rowNode.querySelector('.main-list-row-bottom');
        const title = rowNode.querySelector('[data-testid="main-list-row-title"]');
        const lufs = rowNode.querySelector('[data-testid="main-list-row-integrated-lufs"]');
        const metadata = rowNode.querySelector('[data-testid="main-list-row-metadata"]');

        if (
          !(topRow instanceof HTMLElement) ||
          !(bottomRow instanceof HTMLElement) ||
          !(title instanceof HTMLElement) ||
          !(lufs instanceof HTMLElement) ||
          !(metadata instanceof HTMLElement)
        ) {
          return null;
        }

        const topRect = topRow.getBoundingClientRect();
        const bottomRect = bottomRow.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const lufsRect = lufs.getBoundingClientRect();
        const metadataRect = metadata.getBoundingClientRect();

        const availableTitleWidth = lufsRect.left - titleRect.left;
        const fillRatio = availableTitleWidth > 0 ? titleRect.width / availableTitleWidth : 0;

        return {
          titleStartsAtRowStart: Math.abs(titleRect.left - topRect.left) <= 3,
          lufsStaysRightAligned: Math.abs(lufsRect.right - topRect.right) <= 3,
          titleStopsAtLufs: titleRect.right <= lufsRect.left + 1,
          titleFillRatio: fillRatio,
          metadataInBottomRow:
            metadataRect.top >= bottomRect.top - 1 &&
            metadataRect.bottom <= bottomRect.bottom + 1,
        };
      });

      expect(layout).not.toBeNull();
      expect(layout?.titleStartsAtRowStart).toBe(true);
      expect(layout?.lufsStaysRightAligned).toBe(true);
      expect(layout?.titleStopsAtLufs).toBe(true);
      expect(layout?.titleFillRatio ?? 0).toBeGreaterThan(0.85);
      expect(layout?.metadataInBottomRow).toBe(true);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
