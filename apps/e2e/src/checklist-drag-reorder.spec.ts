/**
 * Regression: bug fix 2026-04-18 (Task 2)
 *
 * Ethan asked to be able to drag checklist items by grabbing their background
 * (no tiny grab handle) and also reorder them via keyboard. This test is the
 * minimum meaningful proof — three items, pointer-drag the first to after the
 * third, assert order, reload, re-assert persistence. No reference-track setup,
 * no DAW-offset tangent — just the reorder contract.
 */
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('checklist items can be reordered via drag and the new order persists', async () => {
  const dirs = await createE2ETestDirectories('checklist-drag-reorder');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Reorder Song v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
  ]);

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link folder -> one song row.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 2. Seed the checklist directly via localStorage. Items are stored
    //    newest-first. To render as [Alpha, Bravo, Charlie] chronologically
    //    (top = oldest), store them as [Charlie, Bravo, Alpha] (newest-first).
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-song-id]');
      const songId = rows[0]?.getAttribute('data-song-id');
      if (!songId) return;
      const storedNewestFirst = [
        { id: 'item-charlie', text: 'Charlie', completed: false, timestampSeconds: 30, versionNumber: 1 },
        { id: 'item-bravo', text: 'Bravo', completed: false, timestampSeconds: 20, versionNumber: 1 },
        { id: 'item-alpha', text: 'Alpha', completed: false, timestampSeconds: 10, versionNumber: 1 },
      ];
      window.localStorage.setItem(
        'producer-player.song-checklists.v1',
        JSON.stringify({ [songId]: storedNewestFirst }),
      );
    });
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 3. Open the checklist modal.
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

    const rows = page.getByTestId('song-checklist-item-row');
    await expect(rows).toHaveCount(3);

    async function readOrder(): Promise<Array<string | null>> {
      return rows.evaluateAll((nodes) =>
        nodes.map((el) => el.getAttribute('data-item-id')),
      );
    }

    // Pre-check rendered order.
    expect(await readOrder()).toEqual(['item-alpha', 'item-bravo', 'item-charlie']);

    // 4. Drag Alpha (first) to after Charlie (third). dnd-kit uses pointer
    //    sensors, so exercise the same mousedown -> mousemove -> mouseup path
    //    a user would take rather than Playwright's native HTML5 drag helper.
    const alphaRow = page.locator('[data-item-id="item-alpha"]');
    const charlieRow = page.locator('[data-item-id="item-charlie"]');
    const alphaBox = await alphaRow.boundingBox();
    const charlieBox = await charlieRow.boundingBox();
    if (!alphaBox) throw new Error('Alpha row has no bounding box');
    if (!charlieBox) throw new Error('Charlie row has no bounding box');
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2 + 8);
    await page.mouse.move(charlieBox.x + charlieBox.width / 2, charlieBox.y + charlieBox.height - 4, {
      steps: 12,
    });
    await page.mouse.up();

    // 5. Assert the new order: Bravo, Charlie, Alpha.
    await expect
      .poll(async () => readOrder(), { timeout: 5_000, intervals: [100] })
      .toEqual(['item-bravo', 'item-charlie', 'item-alpha']);

    // 6. Close modal, let persistence flush, reload, re-open, assert order.
    await page
      .getByTestId('song-checklist-modal')
      .getByRole('button', { name: 'Done' })
      .click();
    await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId('song-checklist-button').click();
    await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    await expect(page.getByTestId('song-checklist-item-row')).toHaveCount(3);

    expect(await readOrder()).toEqual(['item-bravo', 'item-charlie', 'item-alpha']);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
