import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test.describe('Producer Player desktop shell', () => {
  test('links a folder, groups versions into one logical song, and auto-refreshes on new export', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const electronEntry = path.join(workspaceRoot, 'apps/electron/dist/main.cjs');

    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    await fs.writeFile(path.join(fixtureDirectory, 'Midnight Echo v1.wav'), 'stub-audio-v1');

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

    try {
      await page.waitForSelector('[data-testid="app-shell"]');

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('inspector-song-title')).toContainText('Midnight Echo');
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(1);

      await fs.writeFile(path.join(fixtureDirectory, 'Midnight Echo v2.wav'), 'stub-audio-v2');

      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2, {
        timeout: 15_000,
      });
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
