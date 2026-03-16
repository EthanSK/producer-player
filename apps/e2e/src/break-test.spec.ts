import { test, expect } from '@playwright/test';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Producer Player edge cases', () => {
  test('empty folder shows 0 rows gracefully', async () => {
    const dirs = await createE2ETestDirectories('break-empty');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row')).toHaveCount(0);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('linking the same folder twice deduplicates or handles gracefully', async () => {
    const dirs = await createE2ETestDirectories('break-dedupe');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);

      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      // Should not crash and should not duplicate rows beyond what exists
      await expect(page.getByTestId('app-shell')).toBeVisible();
      const folderCount = await page.getByTestId('linked-folder-item').count();
      expect(folderCount).toBeLessThanOrEqual(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('long filename (200+ chars) appears in list', async () => {
    const dirs = await createE2ETestDirectories('break-longname');
    const longName = 'A'.repeat(180) + ' v1.wav';

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: longName, contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('unicode filenames appear in list', async () => {
    const dirs = await createE2ETestDirectories('break-unicode');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Ñoño Beat v1.wav', contents: 'RIFF stub data' },
      { relativePath: 'Café Track v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('rapid rescan does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-rescan');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      for (let i = 0; i < 5; i++) {
        await page.getByTestId('rescan-button').click();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('non-existent folder path does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-nonexistent');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill('/tmp/does-not-exist-99999');
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('reorderSongs with empty array does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-reorder-empty');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.evaluate(async () => {
        await (window as any).producerPlayer.reorderSongs([]);
      });

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('reorderSongs with fake IDs does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-reorder-fake');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.evaluate(async () => {
        await (window as any).producerPlayer.reorderSongs(['fake-id-1', 'fake-id-2']);
      });

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
