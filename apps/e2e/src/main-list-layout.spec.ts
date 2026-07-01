import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Main list row layout', () => {
  // v3.108 — version capsule moved from the top-right of the row down to
  // the bottom row (replacing the plain "N versions" text).
  // v3.319 — the edit pencil also moved to that bottom metadata row, so
  // the top row is now purely: <title> ... <duration + integrated-LUFS>.
  // Measure against the whole right metadata group, not only the LUFS pill,
  // because the duration chip intentionally occupies the space before LUFS.
  test('title stretches across the top row until the right metadata group, and the V·format pill renders in the bottom row', async () => {
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
        const topMetadataGroup = rowNode.querySelector('.main-list-row-metadata-group');
        const lufs = rowNode.querySelector('[data-testid="main-list-row-integrated-lufs"]');
        const metadata = rowNode.querySelector('[data-testid="main-list-row-metadata"]');
        const editButton = rowNode.querySelector('[data-testid="main-list-row-title-edit-button"]');

        if (
          !(topRow instanceof HTMLElement) ||
          !(bottomRow instanceof HTMLElement) ||
          !(title instanceof HTMLElement) ||
          !(topMetadataGroup instanceof HTMLElement) ||
          !(lufs instanceof HTMLElement) ||
          !(metadata instanceof HTMLElement) ||
          !(editButton instanceof HTMLElement)
        ) {
          return null;
        }

        const topRect = topRow.getBoundingClientRect();
        const bottomRect = bottomRow.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const topMetadataGroupRect = topMetadataGroup.getBoundingClientRect();
        const lufsRect = lufs.getBoundingClientRect();
        const metadataRect = metadata.getBoundingClientRect();
        const editRect = editButton.getBoundingClientRect();

        const availableTitleWidth = topMetadataGroupRect.left - titleRect.left;
        const fillRatio = availableTitleWidth > 0 ? titleRect.width / availableTitleWidth : 0;

        return {
          titleStartsAtRowStart: Math.abs(titleRect.left - topRect.left) <= 3,
          lufsStaysRightAligned: Math.abs(lufsRect.right - topRect.right) <= 3,
          titleStopsAtTopMetadataGroup: titleRect.right <= topMetadataGroupRect.left + 1,
          titleFillRatio: fillRatio,
          metadataInBottomRow:
            metadataRect.top >= bottomRect.top - 1 &&
            metadataRect.bottom <= bottomRect.bottom + 1,
          editButtonInBottomRow:
            editRect.top >= bottomRect.top - 1 &&
            editRect.bottom <= bottomRect.bottom + 1,
          editButtonSitsAfterMetadata: editRect.left >= metadataRect.right - 1,
        };
      });

      expect(layout).not.toBeNull();
      expect(layout?.titleStartsAtRowStart).toBe(true);
      expect(layout?.lufsStaysRightAligned).toBe(true);
      expect(layout?.titleStopsAtTopMetadataGroup).toBe(true);
      expect(layout?.titleFillRatio ?? 0).toBeGreaterThan(0.85);
      expect(layout?.metadataInBottomRow).toBe(true);
      expect(layout?.editButtonInBottomRow).toBe(true);
      expect(layout?.editButtonSitsAfterMetadata).toBe(true);
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
      await expect(editButton).toBeVisible();
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

  test('cancelled track drag clears the amber drag-source row state', async () => {
    const directories = await createE2ETestDirectories('producer-player-main-list-drag-cancel');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Drag Source v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'Drag Target v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z') },
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

      const firstRow = page.getByTestId('main-list-row').filter({ hasText: 'Drag Source' }).first();
      await expect(firstRow).toBeVisible();

      await firstRow.evaluate((rowNode) => {
        const event = new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        });

        rowNode.dispatchEvent(event);
      });

      await expect(firstRow).toHaveClass(/drag-source/);

      await page.evaluate(() => {
        // Regression for Ethan's 2026-07-01 screenshot: a native drag that
        // gets cancelled outside the row can strand the amber drag-source
        // class, making a renamed track look like it gained a weird status.
        window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      });

      await expect(firstRow).not.toHaveClass(/drag-source/);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
