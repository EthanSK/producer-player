import { test, expect } from '@playwright/test';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Producer Player runtime smoke @smoke', () => {
  test('launches app shell @smoke', async () => {
    const dirs = await createE2ETestDirectories('runtime-smoke-launch');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('main-list')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('links folder and renders rows @smoke', async () => {
    const dirs = await createE2ETestDirectories('runtime-smoke-link');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub data' },
      { relativePath: 'Bravo v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, dirs.fixtureDirectory);

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2, { timeout: 15000 });
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
