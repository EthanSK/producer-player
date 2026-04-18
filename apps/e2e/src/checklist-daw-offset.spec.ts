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

async function openChecklistForRowIndex(page: Page, rowIndex: number): Promise<void> {
  const row = page.getByTestId('main-list-row').nth(rowIndex);
  await row.getByTestId('song-checklist-button').click();
  await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
}

async function closeChecklist(page: Page): Promise<void> {
  await page
    .getByTestId('song-checklist-modal')
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);
}

async function seedChecklistsForAllRows(page: Page): Promise<void> {
  // Attach one checklist item at 0:45 ("Fix the kick") to EVERY currently-
  // listed song so the per-song offset test can toggle between them without
  // caring which row is which.
  await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-song-id]');
    const checklists: Record<
      string,
      Array<{
        id: string;
        text: string;
        completed: boolean;
        timestampSeconds: number;
        versionNumber: number;
      }>
    > = {};
    rows.forEach((row, index) => {
      const songId = row.getAttribute('data-song-id');
      if (!songId) return;
      checklists[songId] = [
        {
          id: `daw-offset-item-${index}`,
          text: 'Fix the kick',
          completed: false,
          timestampSeconds: 45,
          versionNumber: 1,
        },
      ];
    });
    window.localStorage.setItem(
      'producer-player.song-checklists.v1',
      JSON.stringify(checklists),
    );
  });
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

  test('DAW offset help icon opens a dialog explaining the feature and closes on Escape', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-help-icon'
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

      // Help icon sits inside the DAW offset control, immediately LEFT of the label.
      const helpWrapper = page.getByTestId('checklist-daw-offset-help');
      await expect(helpWrapper).toBeVisible();

      // Order check — help icon precedes the label text visually.
      const helpAndLabelOrder = await page.evaluate(() => {
        const help = document.querySelector('[data-testid="checklist-daw-offset-help"]');
        const label = document.querySelector('.checklist-daw-offset-label');
        if (!help || !label) return null;
        return help.getBoundingClientRect().left < label.getBoundingClientRect().left;
      });
      expect(helpAndLabelOrder).toBe(true);

      // Click the icon — the portalled dialog should appear. Filter by the
      // help copy since the parent checklist modal is also role=dialog.
      await helpWrapper.getByRole('button', { name: /help/i }).click();
      const helpDialog = page
        .getByRole('dialog')
        .filter({ hasText: /DAW offset shifts every displayed checklist timestamp/i });
      await expect(helpDialog).toBeVisible();
      await expect(helpDialog).toContainText(/exported slice/i);
      await saveScreenshot(page, 'offset-help-dialog.png');

      // Escape closes the help dialog (not the underlying checklist modal).
      await page.keyboard.press('Escape');
      await expect(helpDialog).toBeHidden();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
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

  // Per-song DAW offset behavior (refactor from app-global → per-song).
  // Each song owns its own offset + enabled flag. Changing song A's
  // settings must not leak into song B. When a song has no saved offset,
  // it seeds from the last-used default so users don't re-type 0:42 for
  // every track from the same DAW project.
  test('DAW offset is per-song and does not leak between songs, with last-used default seeding', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-per-song',
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'Track B v1.wav', modifiedAtMs: Date.parse('2026-01-02T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (
          window as typeof window & {
            producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await seedChecklistsForAllRows(page);
      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      // --- Song A: set offset to 00:42 enabled ---
      await openChecklistForRowIndex(page, 0);
      await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('00');
      await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('00');
      await expect(page.getByTestId('checklist-daw-offset-toggle')).not.toBeChecked();

      await page.getByTestId('checklist-daw-offset-minutes').fill('00');
      await page.getByTestId('checklist-daw-offset-seconds').fill('42');
      await page.getByTestId('checklist-daw-offset-toggle').check();

      const badgeA = page.getByTestId('song-checklist-item-timestamp');
      await expect(badgeA).toHaveText('1:27'); // 0:45 + 0:42
      await expect(badgeA).toHaveClass(/is-daw-offset/);
      await saveScreenshot(page, 'per-song-A-0-42.png');
      await closeChecklist(page);

      // --- Song B: opens seeded from last-used default (0:42 enabled).
      //     Per task spec option, we seed both seconds AND enabled from last-
      //     used to match the "saves retyping" QoL behavior.
      await openChecklistForRowIndex(page, 1);
      await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('00');
      await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('42');
      await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();

      // Now change song B to 01:30 enabled.
      await page.getByTestId('checklist-daw-offset-minutes').fill('01');
      await page.getByTestId('checklist-daw-offset-seconds').fill('30');
      const badgeB = page.getByTestId('song-checklist-item-timestamp');
      await expect(badgeB).toHaveText('2:15'); // 0:45 + 1:30
      await saveScreenshot(page, 'per-song-B-1-30.png');
      await closeChecklist(page);

      // --- Back to Song A: still 0:42 (NOT 1:30) ---
      await openChecklistForRowIndex(page, 0);
      await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('00');
      await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('42');
      await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();
      await expect(page.getByTestId('song-checklist-item-timestamp')).toHaveText('1:27');
      await saveScreenshot(page, 'per-song-A-preserved.png');
      await closeChecklist(page);

      // --- And Song B preserves its own 1:30 ---
      await openChecklistForRowIndex(page, 1);
      await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('01');
      await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('30');
      await expect(page.getByTestId('song-checklist-item-timestamp')).toHaveText('2:15');
      await closeChecklist(page);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('per-song DAW offsets survive app reload independently', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-per-song-persist',
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
      { relativePath: 'Track B v1.wav', modifiedAtMs: Date.parse('2026-01-02T00:00:10.000Z') },
    ]);

    // Launch #1: set different offsets for song A (0:42 enabled) and song B (1:30 enabled).
    {
      const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
      try {
        await page.evaluate(async (folderPath) => {
          await (
            window as typeof window & {
              producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
            }
          ).producerPlayer.linkFolder(folderPath);
        }, directories.fixtureDirectory);

        await expect(page.getByTestId('main-list-row')).toHaveCount(2);
        await seedChecklistsForAllRows(page);
        await page.reload();
        await page.waitForSelector('[data-testid="app-shell"]');
        await expect(page.getByTestId('main-list-row')).toHaveCount(2);

        await openChecklistForRowIndex(page, 0);
        await page.getByTestId('checklist-daw-offset-minutes').fill('00');
        await page.getByTestId('checklist-daw-offset-seconds').fill('42');
        await page.getByTestId('checklist-daw-offset-toggle').check();
        await closeChecklist(page);

        await openChecklistForRowIndex(page, 1);
        await page.getByTestId('checklist-daw-offset-minutes').fill('01');
        await page.getByTestId('checklist-daw-offset-seconds').fill('30');
        // toggle already seeded ON from last-used default
        await closeChecklist(page);

        await page.waitForTimeout(1200); // let debounced sync flush
      } finally {
        await electronApp.close();
      }
    }

    // Launch #2: verify each song reloads with its own offset.
    {
      const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
      try {
        await expect(page.getByTestId('main-list-row')).toHaveCount(2);

        await openChecklistForRowIndex(page, 0);
        await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('00');
        await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('42');
        await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();
        await closeChecklist(page);

        await openChecklistForRowIndex(page, 1);
        await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('01');
        await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('30');
        await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();
        await closeChecklist(page);
      } finally {
        await electronApp.close();
        await cleanupE2ETestDirectories(directories);
      }
    }
  });

  test('legacy app-global offset from v3.8.0 state file migrates to last-used default', async () => {
    // Simulate an existing v3.8.0 user whose unified state JSON only carries
    // the old app-global `checklistDawOffsetSeconds` / `checklistDawOffsetEnabled`
    // fields. On first load after upgrade, those values must be preserved as
    // the new `checklistDawOffsetDefault*` so the user's prior setting isn't
    // dropped and it seeds the first unseeded song.
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-daw-offset-migration',
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Track A v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    // Launch #1: let the app link the folder + boot normally so the library
    // scans and recognizes the song. Close cleanly.
    {
      const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
      try {
        await linkFixtureFolder(page, directories.fixtureDirectory);
        await seedChecklistWithTimestamp(page);
        await page.waitForTimeout(1200); // flush debounced sync
      } finally {
        await electronApp.close();
      }
    }

    // Now rewrite the unified state file to look like a v3.8.0 blob: strip
    // the new fields, inject legacy `checklistDawOffsetSeconds` /
    // `checklistDawOffsetEnabled`. Preserve everything else (linkedFolders,
    // songChecklists, etc.) so the next launch finds the library intact.
    const statePath = path.join(
      directories.userDataDirectory,
      'producer-player-user-state.json',
    );
    const raw = await fs.readFile(statePath, 'utf8');
    const existing = JSON.parse(raw) as Record<string, unknown>;
    delete existing.songDawOffsets;
    delete existing.checklistDawOffsetDefaultSeconds;
    delete existing.checklistDawOffsetDefaultEnabled;
    existing.checklistDawOffsetSeconds = 27;
    existing.checklistDawOffsetEnabled = true;
    await fs.writeFile(statePath, JSON.stringify(existing, null, 2), 'utf8');

    // Launch #2: fresh Electron process reads the legacy-shaped file.
    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
    try {
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Open the song's checklist. It has no per-song offset yet, so it must
      // seed from the migrated default: 27 seconds enabled.
      await openChecklistForRowIndex(page, 0);
      await expect(page.getByTestId('checklist-daw-offset-minutes')).toHaveValue('00');
      await expect(page.getByTestId('checklist-daw-offset-seconds')).toHaveValue('27');
      await expect(page.getByTestId('checklist-daw-offset-toggle')).toBeChecked();

      // Item at 0:45 + 0:27 offset → 1:12 displayed.
      await expect(page.getByTestId('song-checklist-item-timestamp')).toHaveText('1:12');
      await saveScreenshot(page, 'migration-legacy-default.png');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
