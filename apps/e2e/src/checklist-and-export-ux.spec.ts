import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Checklist and export UX improvements', () => {
  test('checklist closes when clicking outside the modal card', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-click-outside'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const overlay = page.getByTestId('song-checklist-modal');
      await overlay.click({ position: { x: 5, y: 5 } });

      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist modal does not have a duplicate Close button in header', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-no-close');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await expect(page.getByTestId('song-checklist-close')).toHaveCount(0);
      await expect(
        page.getByTestId('song-checklist-modal').getByRole('button', { name: 'Done' })
      ).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('export latest includes ordering JSON sidecar', async () => {
    const directories = await createE2ETestDirectories('producer-player-export-latest-json');
    const exportDir = path.join(directories.userDataDirectory, 'export-output');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'Beta v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_LATEST_ORDERED_EXPORT_DIRECTORY: exportDir,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('export-latest-ordered-button').click();

      const orderJsonPath = path.join(exportDir, 'producer-player-order.json');
      await expect
        .poll(async () => {
          try {
            const raw = await fs.readFile(orderJsonPath, 'utf8');
            return raw.length > 0;
          } catch {
            return false;
          }
        })
        .toBe(true);

      const raw = await fs.readFile(orderJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as any;
      expect(parsed.schema).toBe('producer-player.playlist-order');
      expect(parsed.version).toBe(1);
      expect(parsed.ordering.songIds.length).toBe(2);

      const files = await fs.readdir(exportDir);
      const audioFiles = files.filter((fileName: string) => fileName.endsWith('.wav'));
      expect(audioFiles.length).toBe(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('search shows all matched version file names without truncation', async () => {
    const directories = await createE2ETestDirectories('producer-player-search-versions');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'MySong v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'MySong v2.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z') },
      { relativePath: 'MySong v3.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:12.000Z') },
      { relativePath: 'Other v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:13.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('search-input').fill('MySong v');

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      const rowText = await page.getByTestId('main-list-row').first().textContent();
      expect(rowText).toContain('MySong v1.wav');
      expect(rowText).toContain('MySong v2.wav');
      expect(rowText).toContain('MySong v3.wav');
      expect(rowText).not.toContain('more)');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
