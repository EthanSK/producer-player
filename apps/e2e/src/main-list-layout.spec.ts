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

  test('track display title can be edited, searched, and restored after relaunch', async () => {
    const directories = await createE2ETestDirectories('producer-player-main-list-title-edit');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Original File Name v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
      },
    ]);

    let firstLaunch: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;
    let secondLaunch: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstLaunch = await launchProducerPlayer(directories.userDataDirectory);
      await firstLaunch.page.evaluate(async (folderPath) => {
        await (
          window as typeof window & {
            producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      const firstRow = firstLaunch.page.getByTestId('main-list-row').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.getByTestId('main-list-row-title')).toHaveText('Original File Name');

      const editButton = firstRow.getByTestId('main-list-row-title-edit-button');
      const rowBox = await firstRow.boundingBox();
      expect(rowBox).not.toBeNull();

      // The edit affordance should not flicker in just because the pointer
      // crossed the row; Ethan wanted it reserved for direct title intent.
      if (rowBox) {
        await firstLaunch.page.mouse.move(rowBox.x + rowBox.width - 8, rowBox.y + 8);
      }
      await expect(editButton).toHaveCSS('opacity', '0');

      await firstRow.getByTestId('main-list-row-title').hover();
      await expect(editButton).toHaveCSS('opacity', '1');
      await editButton.click();
      await firstRow.getByTestId('main-list-row-title-input').fill('Display Title');
      await firstRow.getByTestId('main-list-row-title-input').press('Enter');

      await expect(firstRow.getByTestId('main-list-row-title')).toHaveText('Display Title');

      // Search uses the renderer state hook instead of a visible input so the
      // test stays focused on display-title behavior rather than header layout.
      await firstLaunch.page.evaluate(() => {
        (
          window as typeof window & {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('Display Title');
      });
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);

      await firstLaunch.page.evaluate(() => {
        (
          window as typeof window & {
            __producerPlayerSetSearchText?: (next: string) => void;
          }
        ).__producerPlayerSetSearchText?.('');
      });

      // The unified-state writer is debounced in the renderer; give it one
      // flush window before closing so this test covers the real disk path.
      await firstLaunch.page.waitForTimeout(900);
      await firstLaunch.electronApp.close();
      firstLaunch = null;

      secondLaunch = await launchProducerPlayer(directories.userDataDirectory);
      if ((await secondLaunch.page.getByTestId('main-list-row').count()) === 0) {
        await secondLaunch.page.evaluate(async (folderPath) => {
          await (
            window as typeof window & {
              producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
            }
          ).producerPlayer.linkFolder(folderPath);
        }, directories.fixtureDirectory);
      }

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('main-list-row-title')).toHaveText('Display Title');
    } finally {
      await firstLaunch?.electronApp.close();
      await secondLaunch?.electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
