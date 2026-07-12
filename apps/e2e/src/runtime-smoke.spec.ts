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

  test('quits when its final window closes @smoke', async () => {
    const dirs = await createE2ETestDirectories('runtime-smoke-window-close');
    const { electronApp } = await launchProducerPlayer(dirs.userDataDirectory);
    const electronProcess = electronApp.process();

    const applicationClosed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Producer Player remained running after its final window closed.'));
      }, 10_000);
      electronApp.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const finalWindow = BrowserWindow.getAllWindows()[0];
        setImmediate(() => finalWindow?.close());
      });

      await applicationClosed;
      expect(electronProcess.exitCode).toBe(0);
    } finally {
      if (electronProcess.exitCode === null) {
        await electronApp.close();
      }
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
