import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Checklist modal footer button order', () => {
  test('footer renders Delete All, Clear Completed, then Mastering (Mastering bottom-right)', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-footer-button-order'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // Collect ordered test ids of the three footer buttons.
      const orderedTestIds = await page
        .locator('.checklist-modal-actions [data-testid]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.tagName.toLowerCase() === 'button')
            .map((node) => node.getAttribute('data-testid'))
        );

      expect(orderedTestIds).toEqual([
        'song-checklist-delete-all',
        'song-checklist-clear-completed',
        'song-checklist-open-mastering',
      ]);

      // Sanity check: Mastering button is visually the right-most footer button.
      const footer = page.locator('.checklist-modal-actions');
      const deleteAllBox = await footer
        .getByTestId('song-checklist-delete-all')
        .boundingBox();
      const clearCompletedBox = await footer
        .getByTestId('song-checklist-clear-completed')
        .boundingBox();
      const masteringBox = await footer
        .getByTestId('song-checklist-open-mastering')
        .boundingBox();

      expect(deleteAllBox).not.toBeNull();
      expect(clearCompletedBox).not.toBeNull();
      expect(masteringBox).not.toBeNull();

      if (deleteAllBox && clearCompletedBox && masteringBox) {
        // Delete All is left of Clear Completed (grouped together on the left).
        expect(deleteAllBox.x).toBeLessThan(clearCompletedBox.x);
        // Clear Completed is left of Mastering (Mastering is bottom-right).
        expect(clearCompletedBox.x).toBeLessThan(masteringBox.x);
      }
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
