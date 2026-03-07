import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
}

async function launchProducerPlayer(userDataDirectory: string): Promise<LaunchedApp> {
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const electronEntry = path.join(workspaceRoot, 'apps/electron/dist/main.cjs');

  const electronApp = await electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      PRODUCER_PLAYER_USER_DATA_DIR: userDataDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      PRODUCER_PLAYER_TEST_ID: randomUUID(),
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForSelector('[data-testid="app-shell"]');

  return {
    electronApp,
    page,
  };
}

test.describe('Producer Player desktop shell', () => {
  test('links a folder, groups v-suffix versions (with and without spacing), and auto-refreshes on new export', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    await fs.writeFile(path.join(fixtureDirectory, 'Midnight Echo v1.wav'), 'stub-audio-v1');

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('inspector-song-title')).toContainText('Midnight Echo');
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(1);

      // No space before v2 should still be grouped with Midnight Echo.
      await fs.writeFile(path.join(fixtureDirectory, 'Midnight Echov2.wav'), 'stub-audio-v2');

      // Auto-organize is ON by default, so the older version should be archived.
      const archivedVersionPath = path.join(fixtureDirectory, 'old', 'Midnight Echo v1.wav');

      await expect
        .poll(async () => {
          try {
            await fs.access(archivedVersionPath);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(true);

      await expect(page.getByTestId('inspector-version-row')).toHaveCount(1);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('persists linked folder path and actual-song order across app restarts', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    await fs.writeFile(path.join(fixtureDirectory, 'Alpha v1.wav'), 'stub-audio-alpha');
    await fs.writeFile(path.join(fixtureDirectory, 'Beta v1.wav'), 'stub-audio-beta');

    let expectedFirstSongAfterRestart = 'Beta';

    let firstLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(2);

      const songIds = await firstLaunch.page
        .getByTestId('main-list-row')
        .evaluateAll((elements) =>
          elements
            .map((element) => element.getAttribute('data-song-id'))
            .filter((value): value is string => Boolean(value))
        );

      if (songIds.length >= 2) {
        await firstLaunch.page.evaluate(async (ids) => {
          await (window as any).producerPlayer.reorderSongs([ids[1], ids[0]]);
        }, songIds);
      }

      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');

      expectedFirstSongAfterRestart =
        (await firstLaunch.page.getByTestId('main-list-row').first().textContent())?.trim() ??
        expectedFirstSongAfterRestart;
    } finally {
      await firstLaunch?.electronApp.close();
    }

    let secondLaunch: LaunchedApp | null = null;

    try {
      secondLaunch = await launchProducerPlayer(userDataDirectory);

      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('linked-folder-item').first()).toContainText(
        fixtureDirectory
      );

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('main-list-row').first()).toContainText(
        expectedFirstSongAfterRestart
      );
    } finally {
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
