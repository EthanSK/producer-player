import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

// v3.24 — Floating version switcher + checklist "now-playing" version
// highlight. This spec proves both features end-to-end against the real
// Electron shell.
//
// Scenario A: the floating version-switcher trigger is visible when the
// current song has 2+ versions; opens a panel listing every version;
// clicking a row cues that version and playback reflects the switch.
//
// Scenario B: when a checklist item is tagged v1 (because it was added
// while v1 was playing), it receives the checklist-item--current-version
// highlight while v1 is playing — and NOT while v2 is playing. Switching
// back restores the highlight.

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number; sampleRate?: number } = {}
): Promise<void> {
  const sampleRate = options.sampleRate ?? 44_100;
  const durationMs = options.durationMs ?? 4_000;
  const frequencyHz = options.frequencyHz ?? 440;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
    const value = Math.max(-1, Math.min(1, sample)) * 0.3;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function linkFixtureFolder(page: Page, fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

// Suppress the first-launch auto-open of the Agent Chat Panel (which would
// otherwise cover the bottom-right corner of the viewport and intercept
// clicks on the floating version-switcher trigger). Mirrors the helper used
// by the inspector-drawer spec.
async function suppressAgentPanelOnboarding(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.setItem('producer-player.agent-panel-seen', 'true');
    window.localStorage.setItem(
      'producer-player.agent-panel-onboarding-armed',
      'true'
    );
  });
  await page.reload();
  await page.waitForSelector('[data-testid="app-shell"]');
}

async function cueSongVersionFromInspector(
  page: Page,
  songTitle: string,
  fileName: string
): Promise<void> {
  await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
  await page
    .getByTestId('inspector-version-row')
    .filter({ hasText: fileName })
    .getByRole('button', { name: 'Cue' })
    .click();
  await expect(page.getByTestId('player-track-name')).toContainText(fileName);
}

async function getRequiredBox(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Expected locator to have a bounding box');
  }
  return box;
}

async function dragLocatorBy(
  page: Page,
  locator: Locator,
  deltaX: number,
  deltaY: number,
  options: { xRatio?: number; yRatio?: number } = {}
): Promise<void> {
  const box = await getRequiredBox(locator);
  const startX = box.x + box.width * (options.xRatio ?? 0.5);
  const startY = box.y + box.height * (options.yRatio ?? 0.5);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

async function readStoredSwitcherBounds(
  page: Page,
  storageKey: string
): Promise<{ right: number; bottom: number; width: number; height: number } | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey);
}

async function expectStoredBounds(
  page: Page,
  storageKey: string
): Promise<{ right: number; bottom: number; width: number; height: number }> {
  const bounds = await readStoredSwitcherBounds(page, storageKey);
  expect(bounds).not.toBeNull();
  expect(Number.isFinite(bounds?.right)).toBe(true);
  expect(Number.isFinite(bounds?.bottom)).toBe(true);
  expect(Number.isFinite(bounds?.width)).toBe(true);
  expect(Number.isFinite(bounds?.height)).toBe(true);
  return bounds!;
}

test.describe('v3.24 floating version switcher + now-playing highlight', () => {
  test('scenario A: switcher lists all versions and switching cues the chosen version', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-version-switcher-scenario-a'
    );

    await writeTestWav(path.join(directories.fixtureDirectory, 'Song A v1.wav'), {
      durationMs: 8_000,
      frequencyHz: 220,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Song A v2.wav'), {
      durationMs: 8_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Cue v1 from the inspector so we have a known starting state.
      await cueSongVersionFromInspector(page, 'Song A', 'Song A v1.wav');

      // The floating version-switcher trigger must be visible now (2 versions).
      const trigger = page.getByTestId('version-switcher-trigger');
      await expect(trigger).toBeVisible();

      // Open the panel.
      await trigger.click();
      const panel = page.getByTestId('version-switcher-panel');
      await expect(panel).toBeVisible();

      // Both versions must be listed.
      const rows = panel.locator('[data-testid^="version-switcher-item-"]');
      await expect(rows).toHaveCount(2);
      await expect(panel).toContainText('Song A v1.wav');
      await expect(panel).toContainText('Song A v2.wav');

      // Click the v2 row — playback switches to v2.
      await rows.filter({ hasText: 'Song A v2.wav' }).first().click();
      await expect(page.getByTestId('player-track-name')).toContainText('Song A v2.wav');

      // The panel stays open so users can audition versions in a row.
      await expect(panel).toBeVisible();
      const v2Row = panel.locator('[data-testid^="version-switcher-item-"]').filter({
        hasText: 'Song A v2.wav',
      });
      await expect(v2Row.first()).toHaveAttribute('aria-selected', 'true');

      // Escape closes the panel.
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('scenario A (hidden): single-version song has no floating trigger', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-version-switcher-scenario-a-single'
    );

    await writeTestWav(path.join(directories.fixtureDirectory, 'Lonely v1.wav'), {
      durationMs: 5_000,
      frequencyHz: 330,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await cueSongVersionFromInspector(page, 'Lonely', 'Lonely v1.wav');

      // Only one version → trigger is not rendered.
      await expect(page.getByTestId('version-switcher-trigger')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('scenario B: checklist items tagged v1 are highlighted only while v1 is the playback version', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-version-switcher-scenario-b'
    );

    await writeTestWav(path.join(directories.fixtureDirectory, 'Mix v1.wav'), {
      durationMs: 6_000,
      frequencyHz: 220,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Mix v2.wav'), {
      durationMs: 6_000,
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // --- Add a v1-tagged checklist item while v1 is cued. ---
      await cueSongVersionFromInspector(page, 'Mix', 'Mix v1.wav');
      await page.getByTestId('transport-checklist-button').click();
      const modal = page.getByTestId('song-checklist-modal');
      await expect(modal).toBeVisible();

      const composer = page.getByTestId('song-checklist-input');
      await composer.click();
      await composer.type('Fix low end on v1');
      await page.getByTestId('song-checklist-add').click();

      const v1ItemRow = modal
        .getByTestId('song-checklist-item-row')
        .filter({ hasText: 'Fix low end on v1' })
        .first();
      await expect(v1ItemRow).toBeVisible();
      // Sanity: the new item has the expected version tag in its DOM.
      await expect(v1ItemRow).toHaveAttribute('data-item-version-number', '1');

      // --- Add a v2-tagged item after cueing v2. ---
      // Close the modal first so cueing via the inspector works normally.
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();

      await cueSongVersionFromInspector(page, 'Mix', 'Mix v2.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(modal).toBeVisible();

      await composer.click();
      await composer.type('Adjust master on v2');
      await page.getByTestId('song-checklist-add').click();

      const v2ItemRow = modal
        .getByTestId('song-checklist-item-row')
        .filter({ hasText: 'Adjust master on v2' })
        .first();
      await expect(v2ItemRow).toBeVisible();
      await expect(v2ItemRow).toHaveAttribute('data-item-version-number', '2');

      // v2 is the currently-playing version → v2 item is highlighted, v1 is not.
      await expect(v2ItemRow).toHaveAttribute('data-current-version', 'true');
      await expect(v2ItemRow).toHaveClass(/checklist-item--current-version/);
      await expect(v1ItemRow).toHaveAttribute('data-current-version', 'false');
      await expect(v1ItemRow).not.toHaveClass(/checklist-item--current-version/);

      // --- Switch back to v1 via the floating version switcher. ---
      const trigger = page.getByTestId('version-switcher-trigger');
      await expect(trigger).toBeVisible();
      await trigger.click();

      const panel = page.getByTestId('version-switcher-panel');
      await expect(panel).toBeVisible();
      await panel
        .locator('[data-testid^="version-switcher-item-"]')
        .filter({ hasText: 'Mix v1.wav' })
        .first()
        .click();

      await expect(page.getByTestId('player-track-name')).toContainText('Mix v1.wav');

      // Highlight flips: v1 is now highlighted, v2 is not.
      await expect(v1ItemRow).toHaveAttribute('data-current-version', 'true');
      await expect(v1ItemRow).toHaveClass(/checklist-item--current-version/);
      await expect(v2ItemRow).toHaveAttribute('data-current-version', 'false');
      await expect(v2ItemRow).not.toHaveClass(/checklist-item--current-version/);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('scenario C: song and version switchers move, resize, and persist bounds', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-switcher-panel-bounds'
    );

    await writeTestWav(path.join(directories.fixtureDirectory, 'Song A v1.wav'), {
      durationMs: 6_000,
      frequencyHz: 220,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Song A v2.wav'), {
      durationMs: 6_000,
      frequencyHz: 440,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Song B v1.wav'), {
      durationMs: 6_000,
      frequencyHz: 330,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.setViewportSize({ width: 1280, height: 820 });
      await suppressAgentPanelOnboarding(page);
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      // Song switcher: drag from the header, resize from the bottom-right
      // handle, and prove the anchored bounds are saved.
      await page.getByTestId('quick-switcher-button').click();
      const quickPanel = page.getByTestId('quick-switcher-panel');
      await expect(quickPanel).toBeVisible();
      const quickBefore = await getRequiredBox(quickPanel);

      await dragLocatorBy(page, page.getByTestId('quick-switcher-header'), -90, -70);
      await expect.poll(async () => (await getRequiredBox(quickPanel)).x).toBeLessThan(
        quickBefore.x - 40
      );
      const quickAfterDrag = await getRequiredBox(quickPanel);

      await dragLocatorBy(
        page,
        page.getByTestId('quick-switcher-resize-handle-bottom-right'),
        90,
        70
      );
      await expect.poll(async () => (await getRequiredBox(quickPanel)).width).toBeGreaterThan(
        quickAfterDrag.width + 40
      );
      const quickStored = await expectStoredBounds(
        page,
        'producer-player.quick-switcher-bounds.v1'
      );
      await page.getByTestId('quick-switcher-close').click();
      await expect(quickPanel).toBeHidden();

      // Version switcher: same behaviour once a multi-version song is cued.
      await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().dblclick();
      await expect(page.getByTestId('player-track-name')).toContainText('Song A v2.wav');
      await page.getByTestId('version-switcher-trigger').click();
      const versionPanel = page.getByTestId('version-switcher-panel');
      await expect(versionPanel).toBeVisible();
      const versionBefore = await getRequiredBox(versionPanel);

      await dragLocatorBy(page, page.getByTestId('version-switcher-header'), -80, -65);
      await expect.poll(async () => (await getRequiredBox(versionPanel)).x).toBeLessThan(
        versionBefore.x - 35
      );
      const versionAfterDrag = await getRequiredBox(versionPanel);

      await dragLocatorBy(
        page,
        page.getByTestId('version-switcher-resize-handle-bottom-right'),
        85,
        60
      );
      await expect.poll(async () => (await getRequiredBox(versionPanel)).width).toBeGreaterThan(
        versionAfterDrag.width + 35
      );
      const versionStored = await expectStoredBounds(
        page,
        'producer-player.version-switcher-bounds.v1'
      );

      // Reload the app shell and verify both switchers reopen at the saved
      // size. This catches regressions where drag works but persistence is
      // disconnected from render.
      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('quick-switcher-button').click();
      await expect(quickPanel).toBeVisible();
      const quickReloaded = await getRequiredBox(quickPanel);
      expect(Math.round(quickReloaded.width)).toBe(Math.round(quickStored.width));
      expect(Math.round(quickReloaded.height)).toBe(Math.round(quickStored.height));
      await page.getByTestId('quick-switcher-close').click();
      await expect(quickPanel).toBeHidden();

      await page.getByTestId('main-list-row').filter({ hasText: 'Song A' }).first().dblclick();
      await expect(page.getByTestId('player-track-name')).toContainText('Song A v2.wav');
      await page.getByTestId('version-switcher-trigger').click();
      await expect(versionPanel).toBeVisible();
      const versionReloaded = await getRequiredBox(versionPanel);
      expect(Math.round(versionReloaded.width)).toBe(Math.round(versionStored.width));
      expect(Math.round(versionReloaded.height)).toBe(Math.round(versionStored.height));
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
