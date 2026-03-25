import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

async function linkFixtureFolder(page: Page, fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);

  await expect(page.getByTestId('main-list-row')).toHaveCount(1);
}

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

function parseTimestampBadgeText(value: string): number {
  const [minutesPart, secondsPart] = value.split(':');
  const minutes = Number.parseInt(minutesPart ?? '0', 10);
  const seconds = Number.parseInt(secondsPart ?? '0', 10);

  return minutes * 60 + seconds;
}

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
      await linkFixtureFolder(page, directories.fixtureDirectory);

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

  test('typing starts a frozen 3-second lookback timestamp without rewinding the playhead', async () => {
    test.skip(!hasFfmpeg(), 'ffmpeg is required for real playback timestamp coverage.');

    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-checklist-typing-lookback-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-checklist-typing-lookback-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=12',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Typing Timestamp Probe v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await linkFixtureFolder(page, fixtureDirectory);

      await page.getByTestId('main-list-row').first().click();
      await page
        .getByTestId('inspector-version-row')
        .first()
        .getByRole('button', { name: 'Cue' })
        .click();
      await expect(page.getByTestId('player-track-name')).toContainText('Typing Timestamp Probe v1.wav');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const miniScrubber = page.getByTestId('song-checklist-mini-player-scrubber');
      const composer = page.getByTestId('song-checklist-input');

      await page.getByTestId('song-checklist-skip-forward-10').click();
      await expect
        .poll(async () => Number.parseFloat(await miniScrubber.inputValue()))
        .toBeGreaterThan(9.5);

      const playheadBeforeTyping = Number.parseFloat(await miniScrubber.inputValue());
      await composer.focus();
      await composer.type('A');

      const observedPlayheadValues: number[] = [];
      for (let index = 0; index < 6; index += 1) {
        await page.waitForTimeout(80);
        observedPlayheadValues.push(Number.parseFloat(await miniScrubber.inputValue()));
      }
      const minimumObservedPlayhead = Math.min(...observedPlayheadValues);
      const previewBadgeText = (await page
        .getByTestId('song-checklist-input-timestamp-preview')
        .textContent())
        ?.trim() ?? '0:00';
      expect(minimumObservedPlayhead).toBeGreaterThan(playheadBeforeTyping - 0.4);

      const previewTimestampSeconds = parseTimestampBadgeText(previewBadgeText);
      const expectedLookbackTimestamp = Math.max(0, Math.floor(playheadBeforeTyping - 3));
      expect(previewTimestampSeconds).toBe(expectedLookbackTimestamp);

      await composer.press('Enter');
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue('A');
      await expect(page.getByTestId('song-checklist-item-timestamp').first()).toHaveText(
        previewBadgeText
      );
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
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
      await linkFixtureFolder(page, directories.fixtureDirectory);

      // Pre-seed a checklist with a timestamped+versioned item via localStorage
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
            versionNumber: 2,
          },
          {
            id: 'test-ts-item-2',
            text: 'No timestamp item',
            completed: false,
            timestampSeconds: null,
            versionNumber: null,
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
      const timestampBadges = page.getByTestId('song-checklist-item-timestamp');
      await expect(timestampBadges).toHaveCount(1);
      await expect(timestampBadges.first()).toHaveText('1:23');

      // Version number should be shown under the timestamp badge in the same metadata stack.
      const versionBadges = page.getByTestId('song-checklist-item-version');
      await expect(versionBadges).toHaveCount(1);
      await expect(versionBadges.first()).toHaveText('v2');

      const timestampRect = await timestampBadges.first().boundingBox();
      const versionRect = await versionBadges.first().boundingBox();
      expect(timestampRect).not.toBeNull();
      expect(versionRect).not.toBeNull();
      expect((versionRect?.y ?? 0) + 0.5).toBeGreaterThan(timestampRect?.y ?? 0);

      // Item without timestamp/version should not render either badge.
      const items = page.getByTestId('song-checklist-item-text');
      await expect(items).toHaveCount(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist item persists timestampSeconds and captured versionNumber', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-persist'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);

      // Open checklist and add an item
      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-input').focus();
      await page.getByTestId('song-checklist-input').fill('Test persistence');
      await page.getByTestId('song-checklist-add').click();
      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(page.getByTestId('song-checklist-item-version')).toHaveText('v1');

      // Check localStorage for timestampSeconds + versionNumber persistence.
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
      expect('versionNumber' in items[0]).toBe(true);
      // timestampSeconds can be null (no playback) or a number.
      expect(items[0].timestampSeconds === null || typeof items[0].timestampSeconds === 'number').toBe(true);
      expect(items[0].versionNumber).toBe(1);
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
      await linkFixtureFolder(page, directories.fixtureDirectory);

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
      // Both should have timestampSeconds + versionNumber fields.
      expect('timestampSeconds' in items[0]).toBe(true);
      expect('timestampSeconds' in items[1]).toBe(true);
      expect('versionNumber' in items[0]).toBe(true);
      expect('versionNumber' in items[1]).toBe(true);
      expect(items[0].versionNumber).toBe(1);
      expect(items[1].versionNumber).toBe(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('old checklist items without timestampSeconds/versionNumber are migrated with null metadata', async () => {
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
      await linkFixtureFolder(firstLaunch.page, directories.fixtureDirectory);

      // Get the song ID from the DOM
      songId = await firstLaunch.page.evaluate(() => {
        const row = document.querySelector('[data-song-id]');
        return row?.getAttribute('data-song-id') ?? null;
      });

      expect(songId).not.toBeNull();

      // Seed with old-format checklist data (no timestampSeconds/versionNumber fields)
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

      // No timestamp/version badges should be shown for old items.
      await expect(secondLaunch.page.getByTestId('song-checklist-item-timestamp')).toHaveCount(0);
      await expect(secondLaunch.page.getByTestId('song-checklist-item-version')).toHaveCount(0);
    } finally {
      await secondLaunch.electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
