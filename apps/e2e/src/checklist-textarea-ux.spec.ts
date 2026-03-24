import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
  type LaunchedApp,
} from './helpers/electron-app';

async function linkSingleSongAndOpenChecklist(
  page: LaunchedApp['page'],
  fixtureDirectory: string
): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);

  await expect(page.getByTestId('main-list-row')).toHaveCount(1);

  await page.getByTestId('song-checklist-button').click();
  await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
}

test.describe('Checklist textarea UX', () => {
  test('composer textarea keeps Enter-to-add and supports Shift+Enter multiline draft text', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-composer-textarea');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkSingleSongAndOpenChecklist(page, directories.fixtureDirectory);

      const composer = page.getByTestId('song-checklist-input');
      await expect(composer).toBeVisible();
      await expect(composer).toHaveJSProperty('tagName', 'TEXTAREA');

      await composer.click();
      await composer.type('Line 1');
      await composer.press('Shift+Enter');
      await composer.type('Line 2');

      await expect(composer).toHaveValue('Line 1\nLine 2');
      await expect(page.getByTestId('song-checklist-item-text')).toHaveCount(0);

      await composer.press('Enter');

      const firstItem = page.getByTestId('song-checklist-item-text').first();
      await expect(firstItem).toHaveValue('Line 1\nLine 2');
      await expect(composer).toHaveValue('');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('Shift+Tab toggles focus between the composer and the -10s skip button', async () => {
    const directories = await createE2ETestDirectories('producer-player-checklist-shift-tab-toggle');

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkSingleSongAndOpenChecklist(page, directories.fixtureDirectory);

      const composer = page.getByTestId('song-checklist-input');
      const skipBackTen = page.getByTestId('song-checklist-skip-back-10');

      await composer.focus();
      await composer.press('Shift+Tab');
      await expect(skipBackTen).toBeFocused();

      await skipBackTen.press('Shift+Tab');
      await expect(composer).toBeFocused();

      await composer.press('Shift+Tab');
      await expect(skipBackTen).toBeFocused();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist composer and item textareas match input styling and auto-grow', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-textarea-style-autogrow'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkSingleSongAndOpenChecklist(page, directories.fixtureDirectory);

      const composer = page.getByTestId('song-checklist-input');
      await expect(composer).toHaveJSProperty('tagName', 'TEXTAREA');

      await composer.fill('Short note');
      const composerSingleLineHeight = await composer.evaluate((node) =>
        Math.round(node.getBoundingClientRect().height)
      );

      await composer.fill('Line 1\nLine 2\nLine 3');
      const composerMultiLineHeight = await composer.evaluate((node) =>
        Math.round(node.getBoundingClientRect().height)
      );
      expect(composerMultiLineHeight).toBeGreaterThan(composerSingleLineHeight);

      await page.getByTestId('song-checklist-add').click();

      const itemText = page.getByTestId('song-checklist-item-text').first();
      await expect(itemText).toHaveJSProperty('tagName', 'TEXTAREA');

      await itemText.fill('Single line');
      const itemSingleLineHeight = await itemText.evaluate((node) =>
        Math.round(node.getBoundingClientRect().height)
      );

      await itemText.fill('Line 1\nLine 2\nLine 3\nLine 4');
      const itemMultiLineHeight = await itemText.evaluate((node) =>
        Math.round(node.getBoundingClientRect().height)
      );
      expect(itemMultiLineHeight).toBeGreaterThan(itemSingleLineHeight);

      const styleMatches = await page.evaluate(() => {
        const composerInput = document.querySelector('[data-testid="song-checklist-input"]');
        const itemInput = document.querySelector('[data-testid="song-checklist-item-text"]');

        if (!(composerInput instanceof HTMLElement)) {
          return null;
        }

        if (!(itemInput instanceof HTMLElement)) {
          return null;
        }

        const referenceInput = document.createElement('input');
        referenceInput.type = 'text';
        referenceInput.value = 'reference';
        referenceInput.style.position = 'fixed';
        referenceInput.style.opacity = '0';
        referenceInput.style.pointerEvents = 'none';
        referenceInput.style.inset = '-10000px';
        document.body.appendChild(referenceInput);

        const referenceStyle = window.getComputedStyle(referenceInput);
        const composerStyle = window.getComputedStyle(composerInput);
        const itemStyle = window.getComputedStyle(itemInput);

        const properties = [
          'borderRadius',
          'paddingTop',
          'paddingRight',
          'paddingBottom',
          'paddingLeft',
          'backgroundColor',
          'borderTopWidth',
          'borderTopStyle',
        ] as const;

        const result = {
          composerMatchesInput: properties.every(
            (property) => composerStyle[property] === referenceStyle[property]
          ),
          itemMatchesInput: properties.every(
            (property) => itemStyle[property] === referenceStyle[property]
          ),
          composerOverflowY: composerStyle.overflowY,
          itemOverflowY: itemStyle.overflowY,
        };

        referenceInput.remove();

        return result;
      });

      expect(styleMatches).not.toBeNull();
      expect(styleMatches?.composerMatchesInput).toBe(true);
      expect(styleMatches?.itemMatchesInput).toBe(true);
      expect(styleMatches?.composerOverflowY).toBe('hidden');
      expect(styleMatches?.itemOverflowY).toBe('hidden');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
