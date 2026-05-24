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

  test('listening-device strip collapse control sits at the top-left when expanded', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-collapse-left'
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

      await expect(page.getByTestId('listening-device-strip-collapsed-row')).toBeVisible();
      await page.getByTestId('listening-device-strip-collapsed-toggle').click();

      const collapseButton = page.getByTestId('listening-device-strip-collapse-button');
      await expect(collapseButton).toBeVisible();

      const metrics = await page.evaluate(() => {
        const strip = document.querySelector<HTMLElement>(
          '[data-testid="listening-device-strip"]'
        );
        const button = document.querySelector<HTMLElement>(
          '[data-testid="listening-device-strip-collapse-button"]'
        );
        if (!strip || !button) {
          throw new Error('Listening-device strip or collapse button was not rendered.');
        }
        const stripRect = strip.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          stripLeft: stripRect.left,
          stripRight: stripRect.right,
          buttonLeft: buttonRect.left,
          buttonRight: buttonRect.right,
        };
      });

      // Regression guard for Ethan voice 70957: the expanded strip's Collapse
      // button used to justify to the far top-right of the grid row. Keeping it
      // within a few pixels of the strip's left edge proves it now anchors at
      // the top-left, while the right-edge check catches accidental reverts.
      expect(Math.abs(metrics.buttonLeft - metrics.stripLeft)).toBeLessThanOrEqual(4);
      expect(metrics.buttonRight).toBeLessThan(metrics.stripRight - 24);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist sort keeps outstanding work at the bottom and sorts it by song time', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-outstanding-sort'
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

      await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-song-id]');
        const songId = row?.getAttribute('data-song-id');
        if (!songId) {
          throw new Error('Could not find linked song id for checklist sort test.');
        }

        /*
         * Storage is newest-first while the modal renders oldest->newest. This
         * seed deliberately starts with active work split around completed/note
         * rows, and with outstanding timestamps out of order, so the two
         * buttons have to prove both halves of Ethan's regression request:
         * active todos move to the bottom, then only active todos sort by song
         * timestamp with the latest point at the bottom.
         */
        const storedNewestFirst = [
          {
            id: 'context-note',
            text: 'Context note',
            completed: false,
            timestampSeconds: null,
            versionNumber: 1,
            listeningDeviceId: null,
            isNote: true,
          },
          {
            id: 'todo-early',
            text: 'Fix early transient',
            completed: false,
            timestampSeconds: 30,
            versionNumber: 1,
            listeningDeviceId: null,
          },
          {
            id: 'done-middle',
            text: 'Already checked',
            completed: true,
            timestampSeconds: 90,
            versionNumber: 1,
            listeningDeviceId: null,
            completedAt: 1_779_500_000_000,
          },
          {
            id: 'todo-late',
            text: 'Fix late chorus',
            completed: false,
            timestampSeconds: 210,
            versionNumber: 1,
            listeningDeviceId: null,
          },
        ];

        window.localStorage.setItem(
          'producer-player.song-checklists.v1',
          JSON.stringify({ [songId]: storedNewestFirst }),
        );
      });

      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const rows = page.getByTestId('song-checklist-item-row');
      const readOrder = async (): Promise<string[]> =>
        rows.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-item-id') ?? ''),
        );

      expect(await readOrder()).toEqual([
        'todo-late',
        'done-middle',
        'todo-early',
        'context-note',
      ]);

      await expect(page.getByTestId('checklist-sort-outstanding-to-bottom-collapsed')).toHaveText(
        'Sort: outstanding to bottom'
      );
      await page.getByTestId('checklist-sort-outstanding-to-bottom-collapsed').click();

      await expect
        .poll(async () => readOrder(), { timeout: 5_000, intervals: [100] })
        .toEqual(['done-middle', 'context-note', 'todo-late', 'todo-early']);

      await page.getByTestId('listening-device-strip-collapsed-toggle').click();
      await expect(page.getByTestId('checklist-sort-outstanding-by-time')).toHaveText(
        'Sort outstanding by time'
      );
      await page.getByTestId('checklist-sort-outstanding-by-time').click();

      await expect
        .poll(async () => readOrder(), { timeout: 5_000, intervals: [100] })
        .toEqual(['done-middle', 'context-note', 'todo-early', 'todo-late']);
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
        'Keep this item'
      );
      await expect(page.getByTestId('song-checklist-item-text').last()).toHaveValue(
        'Remove this item'
      );

      const checklistToggles = page.locator('.checklist-item-row input[type="checkbox"]');
      await checklistToggles.last().check();
      await expect(checklistToggles.last()).toBeChecked();

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Clear 1 completed checklist item?');
        await dialog.dismiss();
      });
      await page.getByTestId('song-checklist-clear-completed').click();

      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(2);
      await expect(page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Keep this item'
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

  test('keyboard undo/redo restores checklist removals when text input is not focused', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-command-z-undo');

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

      await page.getByTestId('song-checklist-input').fill('First item');
      await page.getByTestId('song-checklist-add').click();
      await page.getByTestId('song-checklist-input').fill('Second item');
      await page.getByTestId('song-checklist-add').click();

      const items = page.getByTestId('song-checklist-item-text');
      await expect(items).toHaveCount(2);

      await page.locator('.checklist-remove-button').last().click();
      await expect(items).toHaveCount(1);
      await expect(items.first()).toHaveValue('First item');

      const composer = page.getByTestId('song-checklist-input');
      await composer.focus();
      await composer.type('x');
      await page.keyboard.press('Control+z');
      await expect(items).toHaveCount(1);

      await page.getByTestId('song-checklist-skip-back-10').focus();
      await page.keyboard.press('Control+z');
      await expect(items).toHaveCount(2);
      await expect(items.last()).toHaveValue('Second item');

      await page.keyboard.press('Control+Shift+z');
      await expect(items).toHaveCount(1);
      await expect(items.first()).toHaveValue('First item');
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
