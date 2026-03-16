import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  createMessyFolderFixture,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

async function setAutoOrganize(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(async (nextValue) => {
    await (window as any).producerPlayer.setAutoMoveOld(nextValue);
  }, enabled);

  const checkbox = page.getByTestId('auto-organize-checkbox');

  if (enabled) {
    await expect(checkbox).toBeChecked();
    return;
  }

  await expect(checkbox).not.toBeChecked();
}

async function reorderSongsByTitle(page: Page, orderedTitles: string[]): Promise<void> {
  const rowData = await page.getByTestId('main-list-row').evaluateAll((elements) =>
    elements
      .map((element) => ({
        id: element.getAttribute('data-song-id') ?? '',
        text: element.textContent ?? '',
      }))
      .filter((entry) => entry.id.length > 0)
  );

  const orderedSongIds = orderedTitles
    .map((title) => rowData.find((entry) => entry.text.includes(title))?.id)
    .filter((id): id is string => Boolean(id));

  if (orderedSongIds.length !== orderedTitles.length) {
    throw new Error('Could not map requested titles to rows for reorder.');
  }

  await page.evaluate(async (ids) => {
    await (window as any).producerPlayer.reorderSongs(ids);
  }, orderedSongIds);
}

test.describe('folder structure hardening', () => {
  test('ignores nested junk folders and still groups mixed v-suffix/no-space variants', async () => {
    const directories = await createE2ETestDirectories('producer-player-e2e-messy');

    await createMessyFolderFixture(directories.fixtureDirectory, [
      {
        relativePath: 'Signal v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Signalv2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Signal_v3.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: 'Signal-v4.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:04.000Z'),
      },
      {
        relativePath: 'Orbit v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:05.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await setAutoOrganize(page, false);

      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(
        page.getByTestId('main-list-row').filter({ hasText: 'Ignore Me' })
      ).toHaveCount(0);

      await page.getByTestId('main-list-row').filter({ hasText: 'Signal' }).first().click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(4);

      await page.getByTestId('rescan-button').click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(4);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('main list title keeps source casing while metadata bubble keeps version and format tags', async () => {
    const directories = await createE2ETestDirectories('producer-player-e2e-title-casing');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'iLoVeNYDemoMix v7.WAV',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await setAutoOrganize(page, false);

      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      const row = page.getByTestId('main-list-row').first();
      await expect(row.getByTestId('main-list-row-title')).toHaveText('iLoVeNYDemoMix');
      await expect(row.getByTestId('main-list-row-metadata')).toHaveText('v7 · WAV');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('old-only tracks never leak into the album list, and old/ typos do not fuzzy-match a top-level song', async () => {
    const directories = await createE2ETestDirectories('producer-player-e2e-old-only');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Bend the Knees v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'old/Bend the Knees v1.wav',
        modifiedAtMs: Date.parse('2025-12-01T00:00:00.000Z'),
      },
      {
        relativePath: 'old/Bend the Knee v1.wav',
        modifiedAtMs: Date.parse('2025-11-01T00:00:00.000Z'),
      },
      {
        relativePath: 'old/Orphan Song v1.wav',
        modifiedAtMs: Date.parse('2025-10-01T00:00:00.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await setAutoOrganize(page, false);

      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row').filter({ hasText: 'Bend the Knees' })).toHaveCount(1);

      const albumRows = await page.getByTestId('main-list-row').evaluateAll((elements) => {
        return elements.map((element) => element.textContent ?? '');
      });

      expect(albumRows.some((text) => text.includes('Bend the Knee v1.wav'))).toBe(false);
      expect(albumRows.some((text) => text.includes('Orphan Song'))).toBe(false);

      await page.getByTestId('main-list-row').filter({ hasText: 'Bend the Knees' }).first().click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2);
      await expect(page.getByTestId('inspector-version-row').filter({ hasText: 'Bend the Knees v1.wav' })).toHaveCount(1);
      await expect(page.getByTestId('inspector-version-row').filter({ hasText: 'Bend the Knee v1.wav' })).toHaveCount(0);
      await expect(page.getByTestId('inspector-version-row').filter({ hasText: 'Orphan Song v1.wav' })).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('keeps custom order after organize/rescan and preserves it after unlink + relink via sidecar', async () => {
    const directories = await createE2ETestDirectories('producer-player-e2e-relink');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Alpha v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Alphav2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Beta v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:04.000Z'),
      },
      {
        relativePath: 'old/Alpha v1.wav',
        modifiedAtMs: Date.parse('2025-12-01T00:00:00.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await setAutoOrganize(page, false);

      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('main-list-row').first()).toContainText('Beta');

      await reorderSongsByTitle(page, ['Alpha', 'Beta']);
      await expect(page.getByTestId('main-list-row').first()).toContainText('Alpha');

      await page.getByRole('button', { name: 'Organize' }).click();

      const deterministicArchivePath = path.join(
        directories.fixtureDirectory,
        'old',
        'Alpha v1-archived-1.wav'
      );

      await expect
        .poll(async () => {
          try {
            await fs.access(deterministicArchivePath);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(true);

      await page.getByTestId('rescan-button').click();
      await expect(page.getByTestId('main-list-row').first()).toContainText('Alpha');

      await page.getByTestId('linked-folder-item').first().click();
      page.once('dialog', async (dialog) => {
        await dialog.accept();
      });
      await page.getByRole('button', { name: 'Unlink' }).click();

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(0);
      await expect(page.getByTestId('main-list-row')).toHaveCount(0);

      await page.getByTestId('link-folder-path-input').fill(directories.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('main-list-row').first()).toContainText('Alpha');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
