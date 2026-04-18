import path from 'node:path';
import { promises as fs } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

// Screenshots directory for subagent verification proofs. Kept outside the
// repo so it's never accidentally committed.
const SCREENSHOT_DIR = '/tmp/pp-daw-offset';

async function saveScreenshot(page: Page, fileName: string): Promise<void> {
  // Best-effort — if the dir can't be created we just skip.
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, fileName), fullPage: false });
  } catch {
    // ignore
  }
}

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

async function seedChecklistWithTimestamp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-song-id]');
    const songId = rows[0]?.getAttribute('data-song-id');
    if (!songId) return;

    // One item at 45s (renders "0:45" without offset, "2:15" with 1:30 offset).
    const items = [
      {
        id: 'daw-offset-item-1',
        text: 'Fix the kick',
        completed: false,
        timestampSeconds: 45,
        versionNumber: 1,
      },
    ];

    const checklists: Record<string, typeof items> = { [songId]: items };
    window.localStorage.setItem(
      'producer-player.song-checklists.v1',
      JSON.stringify(checklists)
    );
  });
}

async function openChecklist(page: Page): Promise<void> {
  await page.getByTestId('song-checklist-button').click();
  await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
}

test.describe('Checklist DAW time offset', () => {
  test('enabled toggle + 1:30 offset shifts displayed timestamps to green without changing seek target', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-enabled'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await seedChecklistWithTimestamp(page);
      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await openChecklist(page);

      // With the toggle OFF (default), badge reads raw value "0:45".
      const badge = page.getByTestId('song-checklist-item-timestamp');
      await expect(badge).toHaveText('0:45');
      await expect(badge).not.toHaveClass(/is-daw-offset/);
      await saveScreenshot(page, 'offset-off.png');

      // Set offset to 01:30 and enable.
      await page.getByTestId('checklist-daw-offset-minutes').fill('01');
      await page.getByTestId('checklist-daw-offset-seconds').fill('30');
      await page.getByTestId('checklist-daw-offset-toggle').check();

      // Displayed text shifts to 2:15 and gets the green class.
      await expect(badge).toHaveText('2:15');
      await expect(badge).toHaveClass(/is-daw-offset/);
      await saveScreenshot(page, 'offset-on.png');

      // Header-widget close-up via clipped screenshot of the modal header.
      const headerHandle = await page.getByTestId('checklist-daw-offset-control').elementHandle();
      if (headerHandle) {
        try {
          await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
          await headerHandle.screenshot({
            path: path.join(SCREENSHOT_DIR, 'offset-header-widget.png'),
          });
        } catch {
          // ignore
        }
      }

      // The aria-label (which describes the seek target) should still refer to
      // the raw stored timestamp (0:45), not the displayed offset value.
      await expect(badge).toHaveAttribute('aria-label', 'Seek to 0:45');

      // Disable the toggle — badge reverts to raw value + default color.
      await page.getByTestId('checklist-daw-offset-toggle').uncheck();
      await expect(badge).toHaveText('0:45');
      await expect(badge).not.toHaveClass(/is-daw-offset/);
      await expect(badge).toHaveAttribute('aria-label', 'Seek to 0:45');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('DAW offset + toggle state persist across relaunches via unified user state', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-persist'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    // First launch: set offset, enable toggle, confirm applied.
    {
      const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
      try {
        await linkFixtureFolder(page, directories.fixtureDirectory);
        await seedChecklistWithTimestamp(page);
        await page.reload();
        await page.waitForSelector('[data-testid="app-shell"]');
        await expect(page.getByTestId('main-list-row')).toHaveCount(1);

        await openChecklist(page);
        await page.getByTestId('checklist-daw-offset-minutes').fill('02');
        await page.getByTestId('checklist-daw-offset-seconds').fill('05');
        await page.getByTestId('checklist-daw-offset-toggle').check();

        // Give the debounced unified-state sync (500ms) time to flush to disk.
        await page.waitForTimeout(1200);
      } finally {
        await electronApp.close();
      }
    }

    // Second launch: offset + toggle should be remembered.
    {
      const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
      try {
        await expect(page.getByTestId('main-list-row')).toHaveCount(1);
        await openChecklist(page);

        await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('02');
        await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('05');
        await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();

        // Badge reflects persisted 02:05 offset on the 0:45 item = 2:50.
        const badge = page.getByTestId('song-checklist-item-timestamp');
        await expect(badge).toHaveText('2:50');
        await expect(badge).toHaveClass(/is-daw-offset/);
      } finally {
        await electronApp.close();
        await cleanupE2ETestDirectories(directories);
      }
    }
  });
});
