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
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
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
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
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

  test('clear completed checklist asks for confirmation and respects cancel/confirm', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-clear-confirm');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-input').fill('Keep this item');
      await page.getByTestId('song-checklist-add').click();
      await page.getByTestId('song-checklist-input').fill('Remove this item');
      await page.getByTestId('song-checklist-add').click();

      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(2);
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Remove this item'
      );

      const checklistToggles = page.locator('.checklist-item-row input[type="checkbox"]');
      await checklistToggles.first().check();
      await expect(checklistToggles.first()).toBeChecked();

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Clear 1 completed checklist item?');
        await dialog.dismiss();
      });
      await page.getByTestId('song-checklist-clear-completed').click();

      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(2);
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Remove this item'
      );

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Clear 1 completed checklist item?');
        await dialog.accept();
      });
      await page.getByTestId('song-checklist-clear-completed').click();

      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Keep this item'
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist item textarea auto-grows for long notes and shrinks when shortened', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-autogrow');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-input').fill('Short note');
      await page.getByTestId('song-checklist-add').click();

      const itemField = page.getByTestId('song-checklist-item-text').first();
      const initialMetrics = await itemField.evaluate((node) => {
        const textarea = node as HTMLTextAreaElement;
        return {
          clientHeight: textarea.clientHeight,
          styleHeight: Number.parseFloat(textarea.style.height || '0'),
        };
      });

      await itemField.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');

      const grownMetrics = await itemField.evaluate((node) => {
        const textarea = node as HTMLTextAreaElement;
        return {
          clientHeight: textarea.clientHeight,
          styleHeight: Number.parseFloat(textarea.style.height || '0'),
        };
      });

      expect(grownMetrics.clientHeight).toBeGreaterThan(initialMetrics.clientHeight + 12);
      expect(grownMetrics.styleHeight).toBeGreaterThan(initialMetrics.styleHeight + 12);

      await itemField.fill('Short note again');

      const shrunkMetrics = await itemField.evaluate((node) => {
        const textarea = node as HTMLTextAreaElement;
        return {
          clientHeight: textarea.clientHeight,
          styleHeight: Number.parseFloat(textarea.style.height || '0'),
        };
      });

      expect(shrunkMetrics.clientHeight).toBeLessThan(grownMetrics.clientHeight);
      expect(shrunkMetrics.styleHeight).toBeLessThan(grownMetrics.styleHeight);
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
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);
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

});
