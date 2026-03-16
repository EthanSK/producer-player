import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('Playlist export/import ordering', () => {
  test('exports current album selection + order as JSON and can import it back', async () => {
    const directories = await createE2ETestDirectories('producer-player-playlist-export-import');
    const exportPath = path.join(directories.userDataDirectory, 'playlist-order.json');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'Beta v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z') },
      { relativePath: 'Gamma v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:12.000Z') },
      { relativePath: 'Alpha v2.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:13.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_PLAYLIST_EXPORT_PATH: exportPath,
        PRODUCER_PLAYER_E2E_PLAYLIST_IMPORT_PATH: exportPath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(3);

      const initialRowData = await page.getByTestId('main-list-row').evaluateAll((elements) =>
        elements
          .map((element) => ({
            id: element.getAttribute('data-song-id') ?? '',
            text: element.textContent ?? '',
          }))
          .filter((entry) => entry.id.length > 0)
      );

      const reversedOrder = [...initialRowData].reverse().map((entry) => entry.id);

      await page.evaluate(async (ids) => {
        await (window as any).producerPlayer.reorderSongs(ids);
      }, reversedOrder);

      await expect(page.getByTestId('main-list-row').first()).toHaveAttribute(
        'data-song-id',
        reversedOrder[0] ?? ''
      );

      await page.getByTestId('main-list-row').filter({ hasText: 'Alpha' }).click();
      await page
        .getByTestId('inspector-version-row')
        .filter({ hasText: 'Alpha v1.wav' })
        .getByRole('button', { name: 'Cue' })
        .click();
      await expect(page.getByTestId('player-track-name')).toContainText('Alpha v1.wav');

      await page.getByTestId('export-playlist-order-button').click();

      await expect
        .poll(async () => {
          try {
            const raw = await fs.readFile(exportPath, 'utf8');
            return raw.length > 0;
          } catch {
            return false;
          }
        })
        .toBe(true);

      const raw = await fs.readFile(exportPath, 'utf8');
      const parsed = JSON.parse(raw) as any;

      expect(parsed.schema).toBe('producer-player.playlist-order');
      expect(parsed.version).toBe(1);
      expect(parsed.selection?.selectedFolderPath).toBe(directories.fixtureDirectory);
      expect(parsed.selection?.selectedSongNormalizedTitle).toBe('alpha');
      expect(parsed.selection?.selectedPlaybackFileName).toBe('Alpha v1.wav');
      expect(parsed.ordering?.songIds).toEqual(reversedOrder);
      expect(Array.isArray(parsed.songs)).toBe(true);
      expect(parsed.songs.length).toBe(3);

      const nextOrder = [...reversedOrder].reverse();
      await page.evaluate(async (ids) => {
        await (window as any).producerPlayer.reorderSongs(ids);
      }, nextOrder);

      await expect(page.getByTestId('main-list-row').first()).toHaveAttribute(
        'data-song-id',
        nextOrder[0] ?? ''
      );

      await page.getByTestId('main-list-row').filter({ hasText: 'Gamma' }).click();
      await expect(page.getByTestId('inspector-song-title')).toContainText('Gamma');

      await page.getByTestId('import-playlist-order-button').click();

      await expect(page.getByTestId('main-list-row').first()).toHaveAttribute(
        'data-song-id',
        reversedOrder[0] ?? ''
      );
      await expect(page.getByTestId('inspector-song-title')).toContainText('Alpha');
      await expect(page.getByTestId('player-track-name')).toContainText('Alpha v1.wav');
      await expect(page.locator('.panel-left [data-testid="status-card"] .error')).toHaveCount(
        0
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('exports latest versions into an ordered folder with rewritten track-number prefixes', async () => {
    const directories = await createE2ETestDirectories('producer-player-latest-ordered-export');
    const orderedExportPath = path.join(directories.userDataDirectory, 'latest-ordered-exports');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Alpha v1.wav',
        contents: 'alpha-v1',
        modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
      },
      {
        relativePath: 'Alpha v2.wav',
        contents: 'alpha-v2',
        modifiedAtMs: Date.parse('2026-01-01T00:00:13.000Z'),
      },
      {
        relativePath: '07 - Beta v1.wav',
        contents: 'beta-v1',
        modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z'),
      },
      {
        relativePath: 'Gamma v1.wav',
        contents: 'gamma-v1',
        modifiedAtMs: Date.parse('2026-01-01T00:00:12.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_LATEST_ORDERED_EXPORT_DIRECTORY: orderedExportPath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(3);

      const rows = await page.getByTestId('main-list-row').evaluateAll((elements) =>
        elements
          .map((element) => ({
            id: element.getAttribute('data-song-id') ?? '',
            text: element.textContent ?? '',
          }))
          .filter((entry) => entry.id.length > 0)
      );

      const alphaId = rows.find((entry) => entry.text.includes('Alpha'))?.id;
      const betaId = rows.find((entry) => entry.text.includes('Beta'))?.id;
      const gammaId = rows.find((entry) => entry.text.includes('Gamma'))?.id;

      expect(alphaId).toBeTruthy();
      expect(betaId).toBeTruthy();
      expect(gammaId).toBeTruthy();

      const orderedIds = [gammaId, alphaId, betaId].filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );

      await page.evaluate(async (ids) => {
        await (window as any).producerPlayer.reorderSongs(ids);
      }, orderedIds);

      await expect(page.getByTestId('main-list-row').first()).toHaveAttribute(
        'data-song-id',
        gammaId ?? ''
      );

      await page.getByTestId('export-latest-ordered-button').click();

      await expect
        .poll(async () => {
          try {
            const fileNames = await fs.readdir(orderedExportPath);
            return fileNames.length;
          } catch {
            return 0;
          }
        })
        .toBe(4);

      const exportedFiles = (await fs.readdir(orderedExportPath)).sort();
      expect(exportedFiles).toEqual([
        '01 - Gamma v1.wav',
        '02 - Alpha v2.wav',
        '03 - Beta v1.wav',
        'producer-player-order.json',
      ]);

      const alphaLatestExportContents = await fs.readFile(
        path.join(orderedExportPath, '02 - Alpha v2.wav'),
        'utf8'
      );
      expect(alphaLatestExportContents).toBe('alpha-v2');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('shows an error when importing invalid JSON', async () => {
    const directories = await createE2ETestDirectories('producer-player-playlist-import-invalid');
    const importPath = path.join(directories.userDataDirectory, 'playlist-order-invalid.json');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    await fs.writeFile(importPath, JSON.stringify({ not: 'a-playlist-export' }), 'utf8');

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_PLAYLIST_IMPORT_PATH: importPath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('import-playlist-order-button').click();

      await expect(page.locator('.panel-left [data-testid="status-card"] .error')).toContainText(
        'Playlist export'
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
