/**
 * v3.26.0 — Promote Mastering Checklist rows into user checklist items.
 *
 * Spec (Ethan voices 4786-4788):
 *   A. On own mix: each mastering-checklist row exposes an "+ Add to
 *      checklist" button. Clicking it creates a new item in the song
 *      checklist tagged with the currently-playing version number,
 *      carrying the FROM MASTERING eyebrow badge, AND with no
 *      timestamp (timeless items).
 *   B. In reference preview mode, the add buttons are HIDDEN —
 *      references don't have checklist items.
 *   C. Switching to a different version tags newly promoted items with
 *      the new version number.
 *
 * Fixture audio is generated with ffmpeg sine waves so the measured
 * analysis pipeline (LUFS, true peak, DC offset, clipping) runs for
 * real. Without real audio the mastering checklist panel never
 * populates and the affordance we're asserting isn't rendered.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

async function writeSineWav(
  filePath: string,
  frequencyHz: number,
  durationSec: number,
): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequencyHz}:duration=${durationSec}`,
    '-c:a',
    'pcm_s16le',
    filePath,
  ]);
}

test('v3.26 — mastering checklist rows promote into song checklist items with FROM MASTERING badge', async () => {
  const dirs = await createE2ETestDirectories('mastering-to-checklist');

  // Two versions of a single song so we can exercise the version-tag
  // propagation in scenario C.
  const songV1Path = path.join(dirs.fixtureDirectory, 'Track v1.wav');
  const songV2Path = path.join(dirs.fixtureDirectory, 'Track v2.wav');
  const refPath = path.join(dirs.fixtureDirectory, 'Ref.wav');
  await writeSineWav(songV1Path, 220, 3);
  await writeSineWav(songV2Path, 330, 3);
  await writeSineWav(refPath, 440, 3);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // Link folder — should yield one main-list row (the two .wav files
    // share a stem so they are grouped as two versions of one song).
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // Seed the saved-references list + per-song pointer so opening the
    // song auto-loads Ref without going through the native file picker —
    // mirrors the v3-23-polish pattern.
    const songId = await page
      .getByTestId('main-list-row')
      .first()
      .getAttribute('data-song-id');
    expect(songId).toBeTruthy();
    await page.evaluate(
      (args) => {
        const { songId, refPath } = args;
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: refPath,
              fileName: 'Ref.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ]),
        );
        window.localStorage.setItem(`producer-player.reference-track.${songId}`, refPath);
        window.localStorage.setItem(`producer-player.restore-reference.${songId}`, '1');
      },
      { songId: songId as string, refPath },
    );

    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // Select the song → cue v1 (explicitly, so we know which version is
    // tagged on promoted items).
    await page.getByTestId('main-list-row').first().click();
    await page
      .getByTestId('inspector-version-row')
      .filter({ hasText: 'Track v1.wav' })
      .getByRole('button', { name: 'Cue' })
      .click();
    await expect(page.getByTestId('player-track-name')).toContainText('Track v1.wav');

    // Wait for the reference to finish loading (so the Mix/Ref toggle is
    // available for scenario B).
    await expect(page.getByTestId('analysis-reference-summary')).toContainText(
      'Ref.wav',
      { timeout: 20_000 },
    );

    // Open the fullscreen mastering overlay — that's where the mastering
    // checklist panel lives.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();

    // Wait for the mastering checklist panel to actually render (the
    // measured analysis is async). Its rows only appear once both the
    // preview and measured analyses are ready.
    const checklistPanel = page.getByTestId('analysis-mastering-checklist');
    await expect(checklistPanel).toBeVisible({ timeout: 20_000 });
    // v3.27.0 — the panel now renders 4 skeleton rows immediately. Wait
    // for the LOADED state (either a pass/warn/fail class is present)
    // before asserting the real row count, so we don't race the
    // skeleton.
    await expect(checklistPanel).toHaveAttribute('data-checklist-state', 'ready', {
      timeout: 20_000,
    });
    // v3.28.0 — the checklist expanded from 4 rows to the full rule set
    // (~16 rows). Assert "at least 4" rather than exactly 4 so the legacy
    // promotion flow still has a floor, but future rule additions don't
    // break this spec.
    await expect(
      checklistPanel.locator(
        '.mastering-checklist-row.pass, .mastering-checklist-row.warn, .mastering-checklist-row.fail, .mastering-checklist-row.unavailable',
      ).first(),
    ).toBeVisible({ timeout: 20_000 });
    const rowCount = await checklistPanel
      .locator(
        '.mastering-checklist-row.pass, .mastering-checklist-row.warn, .mastering-checklist-row.fail, .mastering-checklist-row.unavailable',
      )
      .count();
    expect(rowCount).toBeGreaterThanOrEqual(4);

    // -----------------------------------------------------------------
    // Scenario A — promote an LUFS row (mix mode) and verify.
    // -----------------------------------------------------------------
    // Pre: we're in mix mode → all four add buttons should be visible.
    await expect(page.getByTestId('mastering-checklist-add-lufs')).toBeVisible();
    await expect(page.getByTestId('mastering-checklist-add-true-peak')).toBeVisible();
    await expect(page.getByTestId('mastering-checklist-add-dc-offset')).toBeVisible();
    await expect(page.getByTestId('mastering-checklist-add-clipping')).toBeVisible();

    await page.getByTestId('mastering-checklist-add-lufs').click();

    // Close the overlay so we can open the song-checklist modal.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    // Open the song checklist and confirm the item landed.
    await page.getByTestId('transport-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

    const items = page.getByTestId('song-checklist-items').locator('li');
    await expect(items).toHaveCount(1);

    const firstItem = items.first();
    // FROM MASTERING eyebrow.
    await expect(
      firstItem.getByTestId('song-checklist-item-from-mastering'),
    ).toBeVisible();
    await expect(
      firstItem.getByTestId('song-checklist-item-from-mastering'),
    ).toHaveText('FROM MASTERING');
    // Version tag matches v1 (what's playing).
    await expect(firstItem.getByTestId('song-checklist-item-version')).toHaveText('v1');
    // Text mentions "LUFS Integrated" — stable substring of the
    // generated message regardless of the exact measured value.
    await expect(firstItem.locator('textarea[data-testid="song-checklist-item-text"]')).toHaveValue(
      /LUFS Integrated/,
    );
    // Timeless item: NO timestamp badge rendered for this row.
    await expect(firstItem.getByTestId('song-checklist-item-timestamp')).toHaveCount(0);

    // Close the checklist modal.
    await page.getByTestId('song-checklist-done-header').click().catch(async () => {
      // Fallback: older footer button.
      await page.keyboard.press('Escape');
    });
    await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);

    // -----------------------------------------------------------------
    // Scenario B — reference preview mode hides the add buttons.
    // -----------------------------------------------------------------
    // Flip the Mix/Ref toggle to Reference.
    await page.getByTestId('analysis-ab-reference').first().click();
    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-reference-mode',
      'true',
    );

    // Re-open fullscreen overlay.
    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
    await expect(checklistPanel).toBeVisible();
    await expect(
      checklistPanel.locator('.reference-text').filter({ hasText: 'Using Reference' }),
    ).toBeVisible();

    // All four add buttons must be HIDDEN.
    await expect(page.getByTestId('mastering-checklist-add-lufs')).toHaveCount(0);
    await expect(page.getByTestId('mastering-checklist-add-true-peak')).toHaveCount(0);
    await expect(page.getByTestId('mastering-checklist-add-dc-offset')).toHaveCount(0);
    await expect(page.getByTestId('mastering-checklist-add-clipping')).toHaveCount(0);

    // Flip back to Mix mode for scenario C.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
    await page.getByTestId('analysis-ab-mix').first().click();
    await expect(page.getByTestId('app-shell')).toHaveAttribute(
      'data-reference-mode',
      'false',
    );

    // -----------------------------------------------------------------
    // Scenario C — switch to v2, promote True Peak, item tagged v2.
    // -----------------------------------------------------------------
    await page
      .getByTestId('inspector-version-row')
      .filter({ hasText: 'Track v2.wav' })
      .getByRole('button', { name: 'Cue' })
      .click();
    await expect(page.getByTestId('player-track-name')).toContainText('Track v2.wav');

    await page.getByTestId('analysis-expand-button').click();
    await expect(page.getByTestId('analysis-modal')).toBeVisible();
    await expect(checklistPanel).toBeVisible();
    // v3.27.0 — the panel now renders 4 skeleton rows immediately. Wait
    // for the LOADED state (either a pass/warn/fail class is present)
    // before asserting the real row count, so we don't race the
    // skeleton.
    await expect(checklistPanel).toHaveAttribute('data-checklist-state', 'ready', {
      timeout: 20_000,
    });
    // v3.28.0 — the checklist expanded from 4 rows to the full rule set
    // (~16 rows). Assert "at least 4" rather than exactly 4 so the legacy
    // promotion flow still has a floor, but future rule additions don't
    // break this spec.
    await expect(
      checklistPanel.locator(
        '.mastering-checklist-row.pass, .mastering-checklist-row.warn, .mastering-checklist-row.fail, .mastering-checklist-row.unavailable',
      ).first(),
    ).toBeVisible({ timeout: 20_000 });
    const rowCountV2 = await checklistPanel
      .locator(
        '.mastering-checklist-row.pass, .mastering-checklist-row.warn, .mastering-checklist-row.fail, .mastering-checklist-row.unavailable',
      )
      .count();
    expect(rowCountV2).toBeGreaterThanOrEqual(4);

    await page.getByTestId('mastering-checklist-add-true-peak').click();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

    await page.getByTestId('transport-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

    // Now there should be 2 items. The NEWLY added one is prepended in
    // storage (newest-first) but rendered in chronological order with
    // the newest at the bottom. So the last rendered item is the v2
    // True Peak one.
    const itemsAfter = page.getByTestId('song-checklist-items').locator('li');
    await expect(itemsAfter).toHaveCount(2);
    const newestItem = itemsAfter.last();
    await expect(
      newestItem.getByTestId('song-checklist-item-from-mastering'),
    ).toBeVisible();
    await expect(newestItem.getByTestId('song-checklist-item-version')).toHaveText('v2');
    await expect(
      newestItem.locator('textarea[data-testid="song-checklist-item-text"]'),
    ).toHaveValue(/dBTP/);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
