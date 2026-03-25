import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
  type LaunchedApp,
} from './helpers/electron-app';

async function linkSingleSongAndOpenChecklist(
  page: LaunchedApp['page'],
  fixtureDirectory: string
): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);

  await expect(page.getByTestId('main-list-row')).toHaveCount(1);

  await page.getByTestId('song-checklist-button').click();
  await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
}

test.describe('Checklist Escape key behavior', () => {
  test('first Escape blurs focused input, second Escape closes the modal', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-escape-blur');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkSingleSongAndOpenChecklist(page, directories.fixtureDirectory);

      const composer = page.getByTestId('song-checklist-input');
      await expect(composer).toBeVisible();

      // Focus the checklist input
      await composer.focus();
      await expect(composer).toBeFocused();

      // First Escape: should blur the input but keep the modal open
      await page.keyboard.press('Escape');
      await expect(composer).not.toBeFocused();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // Second Escape: should close the modal
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('song-checklist-modal')).not.toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('Escape closes modal immediately when no input is focused', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-escape-no-focus'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkSingleSongAndOpenChecklist(page, directories.fixtureDirectory);

      const composer = page.getByTestId('song-checklist-input');
      await expect(composer).toBeVisible();

      // Focus and then blur the input so nothing is focused
      await composer.focus();
      await expect(composer).toBeFocused();
      await composer.blur();
      await expect(composer).not.toBeFocused();

      // Escape should close the modal directly
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('song-checklist-modal')).not.toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
