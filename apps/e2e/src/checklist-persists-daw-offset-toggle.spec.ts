/**
 * Regression: bug fix 2026-04-18 (Task 3)
 *
 * The per-song "DAW offset enabled" toggle lives in the checklist modal
 * header. Ethan reported it "resets to default on app reopen" — meaning the
 * enabled flag didn't persist on a full reload cycle. Expected behaviour:
 * the toggle state (enabled + seconds) is written to the app state file
 * (producer-player-user-state.json -> songDawOffsets[songId]) and restored
 * when the same song's checklist is reopened after a reload.
 */
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('DAW offset enabled toggle persists per-song across app reload', async () => {
  const dirs = await createE2ETestDirectories('checklist-persists-daw-offset-toggle');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Persist Song v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
  ]);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link folder → one song row.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 2. Seed a checklist item so the checklist modal has content to open.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-song-id]');
      const songId = rows[0]?.getAttribute('data-song-id');
      if (!songId) return;
      const items = [
        {
          id: 'persist-toggle-item-1',
          text: 'Persist me',
          completed: false,
          timestampSeconds: 45,
          versionNumber: 1,
        },
      ];
      window.localStorage.setItem(
        'producer-player.song-checklists.v1',
        JSON.stringify({ [songId]: items }),
      );
    });
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 3. Open checklist modal, set offset to 01:30 + enable the toggle.
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await page.getByTestId('checklist-daw-offset-minutes').fill('01');
    await page.getByTestId('checklist-daw-offset-seconds').fill('30');
    const toggle = page.getByTestId('checklist-daw-offset-toggle');
    await toggle.check();
    await expect(toggle).toBeChecked();

    // Close modal.
    await page
      .getByTestId('song-checklist-modal')
      .getByRole('button', { name: 'Done' })
      .click();
    await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);

    // 4. Wait for the debounced unified-state sync (500ms) to flush to disk
    // before reloading.
    await page.waitForTimeout(1500);

    // 5. Reload app.
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 6. Reopen checklist modal — toggle should still be checked and
    // minutes/seconds should still read 01/30.
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();
    await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('01');
    await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('30');

    // 7. Sanity: toggling it OFF and reloading restores it as unchecked.
    await page.getByTestId('checklist-daw-offset-toggle').uncheck();
    await page
      .getByTestId('song-checklist-modal')
      .getByRole('button', { name: 'Done' })
      .click();
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await expect(page.getByTestId('checklist-daw-offset-toggle')).not.toBeChecked();
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
