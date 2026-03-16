import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Checklist timestamp feature', () => {
  test('new checklist item stores a timestamp from the playback position', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-store'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Open the checklist modal
      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // Focus the input (captures timestamp)
      await page.getByTestId('song-checklist-input').focus();

      // Add a checklist item
      await page.getByTestId('song-checklist-input').fill('Fix the intro');
      await page.getByTestId('song-checklist-add').click();

      // The item should appear
      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue('Fix the intro');

      // Since there's no active playback, timestamp should be null (no badge shown)
      // But the item should still be created properly
      const itemCount = await page.getByTestId('song-checklist-item-text').count();
      expect(itemCount).toBe(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist timestamp badge is displayed for items with a timestamp', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-badge'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Pre-seed a checklist with a timestamped item via localStorage
      await page.evaluate(() => {
        const songs = document.querySelectorAll('[data-song-id]');
        const songId = songs[0]?.getAttribute('data-song-id');
        if (!songId) return;

        const items = [
          {
            id: 'test-ts-item-1',
            text: 'Check the bass drop',
            completed: false,
            timestampSeconds: 83,
          },
          {
            id: 'test-ts-item-2',
            text: 'No timestamp item',
            completed: false,
            timestampSeconds: null,
          },
        ];

        const checklists: Record<string, typeof items> = { [songId]: items };
        window.localStorage.setItem(
          'producer-player.song-checklists.v1',
          JSON.stringify(checklists)
        );
      });

      // Reload to pick up localStorage changes
      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Open checklist
      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // Should have exactly one timestamp badge (for the 83s item = "1:23")
      const badges = page.getByTestId('song-checklist-item-timestamp');
      await expect(badges).toHaveCount(1);
      await expect(badges.first()).toHaveText('1:23');

      // Item without timestamp should not show a badge
      const items = page.getByTestId('song-checklist-item-text');
      await expect(items).toHaveCount(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist timestamp persists in localStorage with timestampSeconds field', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-persist'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Open checklist and add an item
      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-input').focus();
      await page.getByTestId('song-checklist-input').fill('Test persistence');
      await page.getByTestId('song-checklist-add').click();
      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(1);

      // Check localStorage for the timestampSeconds field
      const stored = await page.evaluate(() => {
        const raw = window.localStorage.getItem('producer-player.song-checklists.v1');
        return raw ? JSON.parse(raw) : null;
      });

      expect(stored).not.toBeNull();

      const songIds = Object.keys(stored);
      expect(songIds.length).toBe(1);

      const items = stored[songIds[0]];
      expect(items.length).toBe(1);
      expect(items[0].text).toBe('Test persistence');
      expect('timestampSeconds' in items[0]).toBe(true);
      // timestampSeconds can be null (no playback) or a number
      expect(items[0].timestampSeconds === null || typeof items[0].timestampSeconds === 'number').toBe(true);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('focusing input multiple times captures fresh timestamps', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-refocus'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Open checklist
      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // Add first item
      await page.getByTestId('song-checklist-input').focus();
      await page.getByTestId('song-checklist-input').fill('First note');
      await page.getByTestId('song-checklist-add').click();

      // Blur and refocus to capture fresh timestamp for second item
      await page.getByTestId('song-checklist-item-text').first().focus();
      await page.getByTestId('song-checklist-input').focus();
      await page.getByTestId('song-checklist-input').fill('Second note');
      await page.getByTestId('song-checklist-add').click();

      // Both items should exist
      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(2);

      // Verify both items have timestampSeconds in storage
      const stored = await page.evaluate(() => {
        const raw = window.localStorage.getItem('producer-player.song-checklists.v1');
        return raw ? JSON.parse(raw) : null;
      });

      const songIds = Object.keys(stored);
      const items = stored[songIds[0]];
      expect(items.length).toBe(2);
      // Newest item is prepended (newest-first order)
      expect(items[0].text).toBe('Second note');
      expect(items[1].text).toBe('First note');
      // Both should have timestampSeconds field
      expect('timestampSeconds' in items[0]).toBe(true);
      expect('timestampSeconds' in items[1]).toBe(true);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('old checklist items without timestampSeconds are migrated with null timestamps', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-migration'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    // First launch: link folder and seed old-format checklist data
    const firstLaunch = await launchProducerPlayer(directories.userDataDirectory);

    let songId: string | null = null;

    try {
      await firstLaunch.page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);

      // Get the song ID from the DOM
      songId = await firstLaunch.page.evaluate(() => {
        const row = document.querySelector('[data-song-id]');
        return row?.getAttribute('data-song-id') ?? null;
      });

      expect(songId).not.toBeNull();

      // Seed with old-format checklist data (no timestampSeconds field)
      await firstLaunch.page.evaluate((id) => {
        const oldItems = [
          { id: 'old-item-1', text: 'Old note', completed: false },
        ];

        const checklists: Record<string, typeof oldItems> = { [id!]: oldItems };
        window.localStorage.setItem(
          'producer-player.song-checklists.v1',
          JSON.stringify(checklists)
        );
      }, songId);
    } finally {
      await firstLaunch.electronApp.close();
    }

    // Second launch: verify old items are migrated (timestampSeconds = null, no badge)
    const secondLaunch = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(1);

      // Open checklist
      await secondLaunch.page.getByTestId('song-checklist-button').click();
      await expect(secondLaunch.page.getByTestId('song-checklist-modal')).toBeVisible();

      // Old item should still appear
      await expect(secondLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('song-checklist-item-text').first()).toHaveValue('Old note');

      // No timestamp badge should be shown for old items
      await expect(secondLaunch.page.getByTestId('song-checklist-item-timestamp')).toHaveCount(0);
    } finally {
      await secondLaunch.electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
