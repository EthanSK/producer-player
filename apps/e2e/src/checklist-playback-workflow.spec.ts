import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

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
    const value = Math.max(-1, Math.min(1, sample)) * 0.36;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

function formatTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

async function linkFixtureFolder(page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'], fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (window as typeof window & {
      producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
    }).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

async function cueSongVersion(page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'], songTitle: string, fileName: string): Promise<void> {
  await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
  await page
    .getByTestId('inspector-version-row')
    .filter({ hasText: fileName })
    .getByRole('button', { name: 'Cue' })
    .click();
  await expect(page.getByTestId('player-track-name')).toContainText(fileName);
}

async function waitForPlaybackSeconds(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  minimumSeconds: number
): Promise<void> {
  const scrubber = page.getByTestId('player-scrubber');
  await expect
    .poll(async () => Number(await scrubber.inputValue()))
    .toBeGreaterThan(minimumSeconds);
}

test.describe('checklist playback workflow', () => {
  test('typing freezes the preview timestamp and rewinds playback by roughly three seconds', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-typing-freeze'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 7_200,
      frequencyHz: 330,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-play-toggle').click();
      await waitForPlaybackSeconds(page, 3.4);
      await page.getByTestId('song-checklist-play-toggle').click();

      const scrubber = page.getByTestId('player-scrubber');
      const pausedSeconds = Number(await scrubber.inputValue());
      const expectedSeconds = Math.max(0, Math.floor(pausedSeconds - 3));
      const expectedTimestamp = formatTime(expectedSeconds);

      const previewBadge = page.getByTestId('song-checklist-input-timestamp-preview');
      await page.getByTestId('song-checklist-input').fill('A');
      await expect(previewBadge).toHaveText(expectedTimestamp);

      await expect
        .poll(async () => Number(await scrubber.inputValue()))
        .toBeLessThanOrEqual(expectedSeconds + 0.5);
      await expect
        .poll(async () => Number(await scrubber.inputValue()))
        .toBeGreaterThanOrEqual(Math.max(0, expectedSeconds - 0.3));
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('set now captures checklist timestamp and matching items pulse with a long tail when playback reaches them', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-set-now-highlight'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 7_200,
      frequencyHz: 550,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-play-toggle').click();
      await waitForPlaybackSeconds(page, 4.2);
      await page.getByTestId('song-checklist-play-toggle').click();

      await page.getByTestId('song-checklist-set-now').click();
      const previewBadge = page.getByTestId('song-checklist-input-timestamp-preview');
      const capturedPreviewTimestamp = (await previewBadge.textContent())?.trim() ?? '';
      expect(capturedPreviewTimestamp).toMatch(/^\d+:\d{2}$/);

      await page.getByTestId('song-checklist-input').fill('Bass pocket');
      await page.getByTestId('song-checklist-add').click();
      await expect(page.getByTestId('song-checklist-item-timestamp').first()).toHaveText(
        capturedPreviewTimestamp
      );

      await page.getByTestId('song-checklist-skip-back-10').click();

      await page.getByTestId('song-checklist-play-toggle').click();
      const highlightedRow = page.locator('.checklist-item-row').first();
      await expect.poll(async () => {
        const className = await highlightedRow.getAttribute('class');
        return className ?? '';
      }).toContain('is-active');
      await expect
        .poll(async () => (await highlightedRow.getAttribute('class')) ?? '')
        .toMatch(/is-active-pulse-(odd|even)/);

      // Ethan wants a visible "how long ago did this play?" tail, not a
      // tiny flash that vanishes before he can scroll the checklist to find it.
      await page.waitForTimeout(1600);
      await expect
        .poll(async () => (await highlightedRow.getAttribute('class')) ?? '')
        .toContain('is-active');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('main track list shows the total remaining checklist items across all tracks', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-main-list-checklist-total'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      frequencyHz: 330,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      frequencyHz: 660,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('main-list-checklist-total')).toHaveText(
        "Total checklist items remaining: 0 out of 0 · Won't Fix: 0 · Notes: 0"
      );
      await expect(page.getByTestId('main-list-checklist-total')).toHaveAttribute(
        'aria-label',
        "0 of 0 checklist items remaining across all tracks; 0 Won't Fix; 0 notes"
      );

      await page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Track A' })
        .getByTestId('song-checklist-button')
        .click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await page.getByTestId('song-checklist-input').fill('Track A remaining item');
      await page.getByTestId('song-checklist-add').click();
      await expect(page.getByTestId('song-checklist-header-counts')).toHaveText(
        "0/1 todos · 1 left · 0 notes · 0 Won't Fix"
      );
      await page.getByTestId('song-checklist-done-header').click();
      await expect(page.getByTestId('main-list-checklist-total')).toHaveText(
        "Total checklist items remaining: 1 out of 1 · Won't Fix: 0 · Notes: 0"
      );

      await page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Track B' })
        .getByTestId('song-checklist-button')
        .click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await page.getByTestId('song-checklist-input').fill('Track B remaining item');
      await page.getByTestId('song-checklist-add').click();
      await page.getByTestId('song-checklist-input').fill('Track B resolved item');
      await page.getByTestId('song-checklist-add').click();
      await page.getByTestId('song-checklist-input').fill("Track B won't fix item");
      await page.getByTestId('song-checklist-add').click();
      await page.getByTestId('song-checklist-input').fill('Track B note item');
      await page.getByTestId('song-checklist-add').click();

      // Completed items should drop out of the footer total just like they drop
      // out of each per-track "remaining/total" checklist badge.
      await page
        .getByTestId('song-checklist-item-row')
        .filter({ hasText: 'Track B resolved item' })
        .locator('input[type="checkbox"]')
        .check();

      // The footer also reports deliberately ignored todos and permanent
      // notes. Drive those states through the same hover-revealed row controls
      // Ethan uses in the real checklist rather than seeding localStorage.
      const wontFixRow = page
        .getByTestId('song-checklist-item-row')
        .filter({ hasText: "Track B won't fix item" });
      await wontFixRow.hover();
      await wontFixRow.getByTestId('song-checklist-item-wontfix-toggle').click();

      const noteRow = page
        .getByTestId('song-checklist-item-row')
        .filter({ hasText: 'Track B note item' });
      await noteRow.hover();
      await noteRow.getByTestId('song-checklist-item-mode-toggle').click();

      await expect(page.getByTestId('song-checklist-header-counts')).toHaveText(
        "2/3 todos · 1 left · 1 note · 1 Won't Fix"
      );
      await page.getByTestId('song-checklist-done-header').click();

      await expect(page.getByTestId('main-list-checklist-total')).toHaveText(
        "Total checklist items remaining: 2 out of 4 · Won't Fix: 1 · Notes: 1"
      );
      await expect(page.getByTestId('main-list-checklist-total')).toHaveAttribute(
        'aria-label',
        "2 of 4 checklist items remaining across all tracks; 1 Won't Fix; 1 note"
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist scroll stays free over timestamp badges while playback is running', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-scroll-free-while-playing'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 8_000,
      frequencyHz: 515,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const input = page.getByTestId('song-checklist-input');
      const addButton = page.getByTestId('song-checklist-add');
      for (let index = 1; index <= 24; index += 1) {
        await input.fill(`Checklist note ${index}`);
        await addButton.click();
      }

      const scrollRegion = page.getByTestId('song-checklist-scroll-region');
      const scrollMetrics = await scrollRegion.evaluate((node) => ({
        scrollHeight: (node as HTMLDivElement).scrollHeight,
        clientHeight: (node as HTMLDivElement).clientHeight,
      }));
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight + 80);

      await scrollRegion.evaluate((node) => {
        (node as HTMLDivElement).scrollTop = 0;
      });

      await page.getByTestId('song-checklist-play-toggle').click();
      await waitForPlaybackSeconds(page, 0.5);

      const firstTimestampBadge = page.getByTestId('song-checklist-item-timestamp').first();
      await firstTimestampBadge.hover();

      const scrollTopBefore = await scrollRegion.evaluate(
        (node) => (node as HTMLDivElement).scrollTop
      );

      await page.mouse.wheel(0, 420);

      await expect
        .poll(async () =>
          scrollRegion.evaluate((node) => (node as HTMLDivElement).scrollTop)
        )
        .toBeGreaterThan(scrollTopBefore + 50);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist stays pinned at the bottom while playback is running', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-bottom-scroll-stays-pinned-while-playing'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 8_000,
      frequencyHz: 490,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const input = page.getByTestId('song-checklist-input');
      const addButton = page.getByTestId('song-checklist-add');
      for (let index = 1; index <= 36; index += 1) {
        await input.fill(`Pinned-bottom check ${index}`);
        await addButton.click();
      }

      const scrollRegion = page.getByTestId('song-checklist-scroll-region');
      const scrollMetrics = await scrollRegion.evaluate((node) => ({
        scrollHeight: (node as HTMLDivElement).scrollHeight,
        clientHeight: (node as HTMLDivElement).clientHeight,
      }));
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight + 120);

      await page.getByTestId('song-checklist-play-toggle').click();
      await waitForPlaybackSeconds(page, 0.6);

      await scrollRegion.evaluate((node) => {
        const region = node as HTMLDivElement;
        region.scrollTop = region.scrollHeight;
      });
      await scrollRegion.hover();

      for (let index = 0; index < 5; index += 1) {
        await page.mouse.wheel(0, 360);
      }

      const bottomDrift = await scrollRegion.evaluate(async (node) => {
        const region = node as HTMLDivElement;
        const maxTop = Math.max(0, region.scrollHeight - region.clientHeight);
        let worstDistanceFromBottom = maxTop - region.scrollTop;
        const stopAt = performance.now() + 1200;

        while (performance.now() < stopAt) {
          worstDistanceFromBottom = Math.max(
            worstDistanceFromBottom,
            maxTop - region.scrollTop
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }

        return {
          maxTop,
          worstDistanceFromBottom,
          finalDistanceFromBottom: maxTop - region.scrollTop,
        };
      });

      expect(bottomDrift.maxTop).toBeGreaterThan(100);
      expect(bottomDrift.worstDistanceFromBottom).toBeLessThan(14);
      expect(bottomDrift.finalDistanceFromBottom).toBeLessThan(14);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  // Behaviour change (2026-04-18, Task 4): adding a checklist item now scrolls
  // the scroll region to the bottom so the newly-added (and typically still
  // being edited) row is in view. The old test asserted the pre-fix
  // "scroll-position-stays-put" contract; this assertion has been flipped
  // to match the new contract. The dedicated spec that covers this in
  // isolation lives in `checklist-scrolls-to-bottom-on-add.spec.ts`.
  test('adding checklist items scrolls the checklist dialog to the bottom', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-scrolls-to-bottom-on-add-inline'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 8_000,
      frequencyHz: 455,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const input = page.getByTestId('song-checklist-input');
      const addButton = page.getByTestId('song-checklist-add');
      for (let index = 1; index <= 24; index += 1) {
        await input.fill(`Scroll baseline ${index}`);
        await addButton.click();
      }

      const scrollRegion = page.getByTestId('song-checklist-scroll-region');
      // Force the scroll region to the top so we can observe the new
      // scroll-to-bottom behaviour (otherwise it may already be at the bottom).
      await scrollRegion.evaluate((node) => {
        (node as HTMLDivElement).scrollTop = 0;
      });
      const scrollTopBeforeAdd = await scrollRegion.evaluate(
        (node) => (node as HTMLDivElement).scrollTop
      );
      expect(scrollTopBeforeAdd).toBe(0);

      await input.fill('New row should be scrolled into view');
      await addButton.click();

      // Allow the double-rAF scroll effect to settle (see the effect keyed
      // on checklistModalItemsChronological.length in App.tsx).
      await page.waitForTimeout(300);

      // After the add, the scroll region should have moved away from the top
      // and the last row's bottom should be within the visible area.
      await expect
        .poll(async () =>
          scrollRegion.evaluate((node) => (node as HTMLDivElement).scrollTop)
        )
        .toBeGreaterThan(scrollTopBeforeAdd + 30);

      const measurement = await scrollRegion.evaluate((node) => {
        const region = node as HTMLDivElement;
        const rect = region.getBoundingClientRect();
        const rows = region.querySelectorAll<HTMLElement>(
          '[data-testid="song-checklist-item-row"]'
        );
        const lastRow = rows[rows.length - 1];
        if (!lastRow) return null;
        const lastRect = lastRow.getBoundingClientRect();
        return {
          rowBottom: lastRect.bottom,
          rowTop: lastRect.top,
          regionBottom: rect.bottom,
          regionTop: rect.top,
        };
      });
      expect(measurement).not.toBeNull();
      if (!measurement) throw new Error('No row measurement');
      expect(measurement.rowTop).toBeLessThanOrEqual(measurement.regionBottom);
      // Allow <=2px of sub-pixel / scrollbar overlap.
      expect(measurement.rowBottom - measurement.regionBottom).toBeLessThanOrEqual(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('hovered mastering side pane still scrolls while checklist modal is open', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-overlay-hover-scroll-side-pane'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 5_000,
      frequencyHz: 430,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.evaluate(() => {
        const analysisPane = document.querySelector('.analysis-panel') as HTMLElement | null;
        if (!analysisPane) {
          return;
        }

        const spacer = document.createElement('div');
        spacer.setAttribute('data-testid', 'e2e-checklist-overlay-scroll-spacer');
        spacer.style.height = '1600px';
        spacer.style.pointerEvents = 'none';
        analysisPane.appendChild(spacer);
        analysisPane.scrollTop = 0;
      });

      const analysisPane = page.locator('.analysis-panel');
      const analysisPaneBox = await analysisPane.boundingBox();
      if (!analysisPaneBox) {
        throw new Error('Could not resolve analysis pane bounds.');
      }

      await page.mouse.move(
        analysisPaneBox.x + analysisPaneBox.width * 0.5,
        analysisPaneBox.y + Math.min(120, analysisPaneBox.height * 0.5)
      );
      await page.mouse.wheel(0, 480);

      await expect
        .poll(async () =>
          page.evaluate(() => {
            const scroller = document.querySelector('.analysis-panel') as HTMLElement | null;
            return scroller?.scrollTop ?? 0;
          })
        )
        .toBeGreaterThan(120);

      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist mini-player next/direct previous reinitialize while rewind keeps the current checklist', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-mini-player-reinitialize-on-track-nav'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 2_800,
      frequencyHz: 440,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 2_800,
      frequencyHz: 660,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [firstSongTitle, secondSongTitle] = queueTitles.map((title) => title.trim());

      expect(firstSongTitle).toBeTruthy();
      expect(secondSongTitle).toBeTruthy();
      expect(secondSongTitle).not.toBe(firstSongTitle);

      await cueSongVersion(page, firstSongTitle, `${firstSongTitle} v1.wav`);

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      // v3.295: mirror the main player order. Rewind-to-start sits on the
      // outside left, ◀◀/▶▶ flank the play cluster, and Autoplay sits to the
      // right of next instead of splitting the ±timestamp seek buttons.
      const checklistPrimaryTransportOrder = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('.checklist-mini-player-transport > [data-testid]')
        );
        return buttons.map((b) => (b as HTMLElement).dataset.testid);
      });
      expect(checklistPrimaryTransportOrder).toEqual([
        'song-checklist-mini-player-prev',
        'song-checklist-jump-previous-track',
        'song-checklist-mini-player-next',
        'song-checklist-autoplay-next',
      ]);
      const checklistSeekClusterOrder = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('.checklist-transport-group [data-testid]')
        );
        return buttons.map((b) => (b as HTMLElement).dataset.testid);
      });
      expect(checklistSeekClusterOrder).toEqual([
        'song-checklist-skip-back-10',
        'song-checklist-skip-back-5',
        'song-checklist-skip-back-2',
        'song-checklist-play-toggle',
        'song-checklist-skip-forward-2',
        'song-checklist-skip-forward-5',
        'song-checklist-skip-forward-10',
      ]);
      await expect(page.getByTestId('song-checklist-jump-previous-track')).toHaveText('◀◀');
      await expect(
        page.getByTestId('song-checklist-mini-player-prev').locator('.rewind-to-start-icon')
      ).toBeVisible();

      // Layout regression for v3.282: the direct previous-track button lives
      // in its own auto-sized grid column. When it accidentally sat in the
      // stretchy play/skip column, the previous-track button became much wider
      // than the rewind button and pushed the checklist transport controls onto
      // another row.
      const checklistTransportGeometry = await page.evaluate(() => {
        const readRect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) {
            throw new Error(`Missing checklist transport element: ${selector}`);
          }
          const rect = element.getBoundingClientRect();
          return {
            width: rect.width,
            top: rect.top,
            bottom: rect.bottom,
            centerY: rect.top + rect.height / 2,
          };
        };

        return {
          prev: readRect('[data-testid="song-checklist-mini-player-prev"]'),
          jump: readRect('[data-testid="song-checklist-jump-previous-track"]'),
          skipGroup: readRect('.checklist-transport-group'),
          next: readRect('[data-testid="song-checklist-mini-player-next"]'),
          autoplay: readRect('[data-testid="song-checklist-autoplay-next"]'),
        };
      });
      expect(Math.abs(checklistTransportGeometry.jump.width - checklistTransportGeometry.prev.width))
        .toBeLessThanOrEqual(1);
      expect(checklistTransportGeometry.jump.width).toBeLessThanOrEqual(36);
      for (const rect of [
        checklistTransportGeometry.jump,
        checklistTransportGeometry.skipGroup,
        checklistTransportGeometry.next,
        checklistTransportGeometry.autoplay,
      ]) {
        expect(Math.abs(rect.centerY - checklistTransportGeometry.prev.centerY))
          .toBeLessThanOrEqual(2);
      }

      const checklistInput = page.getByTestId('song-checklist-input');
      await checklistInput.fill('draft for current song');

      await page.getByTestId('song-checklist-mini-player-next').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${secondSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('');

      await checklistInput.fill('draft for moved song');

      await page.getByTestId('song-checklist-jump-previous-track').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${firstSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${firstSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('');

      await checklistInput.fill('draft after direct jump');

      await page.getByTestId('song-checklist-mini-player-next').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${secondSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('');

      await checklistInput.fill('draft for rewind button');

      const miniScrubber = page.getByTestId('song-checklist-mini-player-scrubber');
      // The mini-player input is controlled by the active audio duration. Wait
      // for the newly navigated track to expose a real max before forcing a
      // mid-song seek, otherwise React legitimately clamps the value back to 0.
      await expect
        .poll(async () => Number.parseFloat((await miniScrubber.getAttribute('max')) ?? '0'))
        .toBeGreaterThan(2);
      // Use the real mini-player seek button instead of mutating the
      // controlled range input by hand. React can legitimately restore the
      // DOM value to the current app state before the synthetic range change
      // lands, while the +2s button goes through the same handler a user uses.
      await page.getByTestId('song-checklist-skip-forward-2').click();
      await expect
        .poll(async () => Number.parseFloat(await miniScrubber.inputValue()))
        .toBeGreaterThan(1);

      await page.getByTestId('song-checklist-mini-player-prev').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${secondSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('draft for rewind button');
      await expect
        .poll(async () => Number.parseFloat(await miniScrubber.inputValue()))
        .toBeLessThan(0.25);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('checklist warns when the modal track is not the loaded playback track', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-track-mismatch-warning'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 2_800,
      frequencyHz: 440,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 2_800,
      frequencyHz: 660,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [firstSongTitle, secondSongTitle] = queueTitles.map((title) => title.trim());

      expect(firstSongTitle).toBeTruthy();
      expect(secondSongTitle).toBeTruthy();
      expect(secondSongTitle).not.toBe(firstSongTitle);

      await cueSongVersion(page, secondSongTitle, `${secondSongTitle} v1.wav`);

      // Matched case: the checklist is for the same song that the player has
      // loaded, so the mini-player should stay quiet.
      await page
        .getByTestId('main-list-row')
        .filter({ hasText: secondSongTitle })
        .first()
        .getByTestId('song-checklist-button')
        .click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
      await expect(page.getByTestId('song-checklist-track-mismatch-warning')).toHaveCount(0);

      await page.getByTestId('song-checklist-done-header').click();
      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);

      // Mismatched case: opening Track A's checklist must not silently imply
      // that the scrubber is controlling Track A while Track B remains loaded.
      await page
        .getByTestId('main-list-row')
        .filter({ hasText: firstSongTitle })
        .first()
        .getByTestId('song-checklist-button')
        .click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${firstSongTitle} Checklist`
      );
      await expect(page.getByTestId('player-track-name')).toContainText(`${secondSongTitle} v1.wav`);

      const warning = page.getByTestId('song-checklist-track-mismatch-warning');
      await expect(warning).toBeVisible();
      await expect(warning).toContainText('Not playing this track.');
      await expect(warning).toContainText(`Playing: ${secondSongTitle}`);
      await expect(page.getByTestId('song-checklist-track-mismatch-name')).toHaveText(
        secondSongTitle
      );

      const playTrackButton = page.getByTestId('song-checklist-play-track');
      await expect(playTrackButton).toBeVisible();
      await expect(playTrackButton).toHaveText('Play track');

      // Voice 10171 — Ethan wanted this control on the right-hand side of the
      // mismatch message, so lock the geometry instead of only checking that the
      // button exists somewhere in the modal.
      const warningActionLayout = await warning.evaluate((warningElement) => {
        const copy = warningElement.querySelector('.checklist-mini-player-track-warning-copy');
        const action = warningElement.querySelector('[data-testid="song-checklist-play-track"]');
        if (!(copy instanceof HTMLElement) || !(action instanceof HTMLElement)) {
          throw new Error('Missing mismatch-warning copy or Play track button.');
        }

        return {
          copyLeft: copy.getBoundingClientRect().left,
          actionLeft: action.getBoundingClientRect().left,
        };
      });
      expect(warningActionLayout.actionLeft).toBeGreaterThan(warningActionLayout.copyLeft);

      await playTrackButton.click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${firstSongTitle} v1.wav`);
      await expect(page.getByTestId('song-checklist-track-mismatch-warning')).toHaveCount(0);
      await waitForPlaybackSeconds(page, 0.2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('typing at track end pauses instead of auto-advancing the checklist modal', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-pause-at-end-while-typing'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 2_400,
      frequencyHz: 440,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 2_400,
      frequencyHz: 660,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await page.getByTestId('song-checklist-play-toggle').click();
      await waitForPlaybackSeconds(page, 1.6);
      await page.getByTestId('song-checklist-input').fill('still typing');

      await page.waitForTimeout(1600);
      await expect(page.getByTestId('player-track-name')).toContainText('Track A v1.wav');
      await expect(page.locator('.checklist-modal-header h2')).toContainText('Track A Checklist');
      await expect(page.getByTestId('song-checklist-play-toggle')).toHaveAttribute('data-playing', 'false');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('when not typing, track end advances playback and the open checklist follows the next song', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-auto-advance-next-song'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 1_800,
      frequencyHz: 300,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 1_800,
      frequencyHz: 700,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [firstSongTitle, secondSongTitle] = queueTitles.map((title) => title.trim());
      expect(firstSongTitle).toBeTruthy();
      expect(secondSongTitle).toBeTruthy();

      await cueSongVersion(page, firstSongTitle, `${firstSongTitle} v1.wav`);

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await page.getByTestId('song-checklist-play-toggle').click();

      await expect
        .poll(async () => (await page.getByTestId('player-track-name').textContent()) ?? '')
        .toContain(`${secondSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('natural autoplay prefetches the next source and reserves a quiet handoff window', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-autoplay-handoff-prefetch'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 1_900,
      frequencyHz: 300,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 1_900,
      frequencyHz: 700,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [firstSongTitle, secondSongTitle] = queueTitles.map((title) => title.trim());
      expect(firstSongTitle).toBeTruthy();
      expect(secondSongTitle).toBeTruthy();

      const firstFileName = `${firstSongTitle} v1.wav`;
      const secondFileName = `${secondSongTitle} v1.wav`;
      const secondTrackPath = path.join(directories.fixtureDirectory, secondFileName);

      await cueSongVersion(page, firstSongTitle, firstFileName);

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await page.getByTestId('song-checklist-play-toggle').click();

      await expect
        .poll(async () =>
          page.evaluate((expectedPath) => {
            const hook = (window as unknown as {
              __producerPlayerGetPlaybackHandoffState?: () => {
                cachedSourceFilePaths: string[];
              };
            }).__producerPlayerGetPlaybackHandoffState;
            return hook?.().cachedSourceFilePaths.includes(expectedPath) ?? false;
          }, secondTrackPath)
        )
        .toBe(true);

      await expect
        .poll(async () =>
          page.evaluate((expectedPath) => {
            const hook = (window as unknown as {
              __producerPlayerGetPlaybackHandoffState?: () => {
                preloadedSourceFilePath: string | null;
                preloadedReadyState: number | null;
                preloadedStatus: string | null;
              };
            }).__producerPlayerGetPlaybackHandoffState;
            const state = hook?.();
            return Boolean(
              state &&
                state.preloadedSourceFilePath === expectedPath &&
                state.preloadedStatus === 'ready' &&
                (state.preloadedReadyState ?? 0) >= 2
            );
          }, secondTrackPath)
        )
        .toBe(true);

      await expect
        .poll(async () => (await page.getByTestId('player-track-name').textContent()) ?? '')
        .toContain(secondFileName);

      // The transition itself should leave the background queues in the longer
      // handoff grace window, so stats/warmup cannot start in the audible gap.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const hook = (window as unknown as {
              __producerPlayerGetPlaybackHandoffState?: () => {
                pausedUntilMs: number;
              };
            }).__producerPlayerGetPlaybackHandoffState;
            const state = hook?.();
            return state ? state.pausedUntilMs - Date.now() : 0;
          })
        )
        .toBeGreaterThan(500);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('autoplay-next toggle is shared, persisted, and stops natural track-end advance', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-autoplay-next-toggle'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 1_600,
      frequencyHz: 300,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 1_600,
      frequencyHz: 700,
    });

    let launched: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      launched = await launchProducerPlayer(directories.userDataDirectory);
      let page = launched.page;

      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [firstSongTitle] = queueTitles.map((title) => title.trim());
      expect(firstSongTitle).toBeTruthy();

      await cueSongVersion(page, firstSongTitle, `${firstSongTitle} v1.wav`);

      const mainAutoplay = page.getByTestId('player-autoplay-next');
      await expect(mainAutoplay).toHaveAttribute('aria-pressed', 'true');
      await expect(mainAutoplay).toHaveAttribute('data-tooltip', /Autoplay next: On/);

      await mainAutoplay.click();
      await expect(mainAutoplay).toHaveAttribute('aria-pressed', 'false');
      await expect(mainAutoplay).toHaveAttribute('data-tooltip', /saved between app restarts/);

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await expect(page.getByTestId('song-checklist-autoplay-next')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await page.getByTestId('song-checklist-done-header').click();

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-autoplay-next')).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      // The renderer mirrors the setting to localStorage immediately and also
      // debounces it into unified state. Wait for the debounce so this test
      // proves both real app restart paths see the same user choice.
      await page.waitForTimeout(700);
      await launched.electronApp.close();

      launched = await launchProducerPlayer(directories.userDataDirectory);
      page = launched.page;

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('player-autoplay-next')).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      await cueSongVersion(page, firstSongTitle, `${firstSongTitle} v1.wav`);
      await page.getByTestId('player-play-toggle').click();

      await page.waitForTimeout(2_200);
      await expect(page.getByTestId('player-track-name')).toContainText(
        `${firstSongTitle} v1.wav`
      );
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
        'data-playing',
        'false'
      );
    } finally {
      await launched?.electronApp.close().catch(() => undefined);
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('reference listening mode labels tonal/spectrum panels and shows reference tonal balance', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-reference-mode-tonal-balance-labels'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 3_600,
      frequencyHz: 110,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 3_600,
      frequencyHz: 7200,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const queueTitles = await page.getByTestId('main-list-row-title').allTextContents();
      const [referenceSongTitle, mixSongTitle] = queueTitles.map((title) => title.trim());

      expect(referenceSongTitle).toBeTruthy();
      expect(mixSongTitle).toBeTruthy();
      expect(referenceSongTitle).not.toBe(mixSongTitle);

      await cueSongVersion(page, referenceSongTitle, `${referenceSongTitle} v1.wav`);

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      const setCurrentReferenceButton = page.getByTestId('analysis-overlay-set-current-reference');
      await expect(setCurrentReferenceButton).toBeEnabled();
      await setCurrentReferenceButton.click();

      const referenceModeButton = page.getByTestId('analysis-overlay-ab-reference');
      await expect(referenceModeButton).toBeEnabled();

      await page.getByTestId('analysis-overlay-next').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${mixSongTitle} v1.wav`);

      await expect(page.getByTestId('analysis-overlay-tonal-balance')).toHaveAttribute(
        'data-source',
        'mix-track'
      );

      await referenceModeButton.click();
      await expect(page.getByTestId('analysis-overlay-tonal-balance-heading')).toContainText(
        'Using Reference'
      );
      await expect(page.getByTestId('analysis-overlay-spectrum-heading')).toContainText(
        'Using Reference'
      );
      await expect(page.getByTestId('analysis-overlay-tonal-balance')).toHaveAttribute(
        'data-source',
        'reference-track'
      );

      await page
        .getByTestId('analysis-overlay-spectrum-heading')
        .locator('.help-tooltip-trigger')
        .click();
      const tutorialDialog = page
        .getByRole('dialog')
        .filter({ hasText: /Video Tutorials \(order ranked by AI\)/i });
      await expect(tutorialDialog).toBeVisible();
      // Current tooltip UI renders clickable thumbnail cards instead of the
      // old text-only anchor list; keep proving the same ranked nine-link
      // contract while matching the production presentation.
      const rankedTutorialCards = tutorialDialog.locator('[title^="#"]');
      await expect(rankedTutorialCards).toHaveCount(9);
      await expect(tutorialDialog.locator('[title^="#9:"]')).toBeVisible();
      await page.locator('button[aria-label="Close"]').first().click();
      await expect(tutorialDialog).toHaveCount(0);
      await expect(page.getByTestId('analysis-overlay-loudness-peaks')).toContainText(
        'Using Reference'
      );

      const normalizationToggle = page.getByTestId('analysis-overlay-normalization-toggle');
      await expect(normalizationToggle).toBeEnabled();
      await normalizationToggle.click();
      await expect(normalizationToggle).toContainText('Preview On');

      const resetSessionButton = page.getByTestId('analysis-overlay-reset-session');
      await expect(resetSessionButton).toBeVisible();
      await resetSessionButton.click();

      await expect(page.getByTestId('analysis-overlay-ab-mix')).toHaveClass(/active/);
      await expect(page.getByTestId('analysis-overlay-ab-reference')).toBeDisabled();
      await expect(page.getByTestId('analysis-overlay-tonal-balance-heading')).not.toContainText(
        'Using Reference'
      );
      await expect(page.getByTestId('analysis-overlay-loudness-peaks')).not.toContainText(
        'Using Reference'
      );
      await expect(normalizationToggle).toContainText('Preview Off');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('analysis overlay closes on outside click and selected spectrum bands can be cleared', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-analysis-overlay-click-outside-clear-bands'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 12_000,
      frequencyHz: 500,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      const miniSpectrum = page.getByTestId('spectrum-analyzer-mini');
      const miniLevelMeter = page.getByTestId('level-meter-mini');
      await expect(miniSpectrum).toBeVisible();
      await expect(miniLevelMeter).toBeVisible();

      const miniSpectrumWidth = await miniSpectrum.evaluate((element) =>
        Math.round(element.getBoundingClientRect().width)
      );
      const miniLevelMeterWidth = await miniLevelMeter.evaluate((element) =>
        Math.round(element.getBoundingClientRect().width)
      );
      expect(miniLevelMeterWidth).toBe(miniSpectrumWidth);

      const skipBack5 = page.getByTestId('player-skip-back-5');
      const skipForward5 = page.getByTestId('player-skip-forward-5');
      const skipBack2 = page.getByTestId('player-skip-back-2');
      const skipForward2 = page.getByTestId('player-skip-forward-2');
      const jumpPreviousTrack = page.getByTestId('player-jump-previous-track');
      await expect(jumpPreviousTrack).toBeVisible();
      await expect(skipBack5).toBeVisible();
      await expect(skipForward5).toBeVisible();
      await expect(skipBack2).toBeVisible();
      await expect(skipForward2).toBeVisible();

      // The direct previous-track jump is main track navigation, not another
      // second-skip chip; lock ◀◀ next to the one-arrow start button.
      const skipRowOrder = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('.transport-skip-row [data-testid]')
        );
        return buttons.map((b) => (b as HTMLElement).dataset.testid);
      });
      expect(skipRowOrder).toEqual([
        'player-skip-back-10',
        'player-skip-back-5',
        'player-skip-back-2',
        'player-skip-back-1',
        'player-skip-forward-1',
        'player-skip-forward-2',
        'player-skip-forward-5',
        'player-skip-forward-10',
      ]);
      const mainTransportOrder = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('.transport-main-row [data-testid]')
        );
        return buttons.map((b) => (b as HTMLElement).dataset.testid);
      });
      expect(mainTransportOrder).toEqual([
        'player-prev',
        'player-jump-previous-track',
        'player-play-toggle',
        'player-next',
        'player-autoplay-next',
      ]);
      await expect(page.getByTestId('player-jump-previous-track')).toHaveText('◀◀');
      await expect(page.getByTestId('player-prev').locator('.rewind-to-start-icon')).toBeVisible();

      const scrubber = page.getByTestId('player-scrubber');
      const scrubberStart = Number(await scrubber.inputValue());
      await skipForward5.click();
      await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(
        scrubberStart + 1
      );
      await skipBack5.click();
      await expect.poll(async () => Number(await scrubber.inputValue())).toBeLessThanOrEqual(
        scrubberStart + 0.1
      );

      // Verify +2 / -2 buttons actually seek by the expected delta
      const beforeForward2 = Number(await scrubber.inputValue());
      await skipForward2.click();
      await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(
        beforeForward2 + 0.5
      );
      const afterForward2 = Number(await scrubber.inputValue());
      await skipBack2.click();
      await expect
        .poll(async () => Number(await scrubber.inputValue()))
        .toBeLessThan(afterForward2 - 0.5);

      const firstBandClickX = Math.max(8, Math.round(miniSpectrumWidth * 0.25));
      const secondBandClickX = Math.min(miniSpectrumWidth - 8, Math.round(miniSpectrumWidth * 0.75));

      await miniSpectrum.click({ position: { x: firstBandClickX, y: 24 } });
      await expect(miniSpectrum).toHaveAttribute('data-active-bands', /^[0-5]$/);
      const miniSpectrumStatus = page.getByTestId('player-dock-spectrum-solo-label');
      await expect(miniSpectrumStatus).toContainText('Soloing:');
      await expect(page.getByTestId('player-dock-clear-solo-bands')).toBeVisible();

      await miniSpectrum.click({ position: { x: secondBandClickX, y: 24 }, modifiers: ['Shift'] });
      await expect(miniSpectrum).toHaveAttribute('data-active-bands', /,/);
      await expect(miniSpectrumStatus).toContainText('+');

      await miniSpectrum.click({ position: { x: secondBandClickX, y: 24 } });
      await expect(miniSpectrum).toHaveAttribute('data-active-bands', /^[0-5]$/);

      await page.getByTestId('player-dock-clear-solo-bands').click();
      await expect(miniSpectrum).toHaveAttribute('data-active-bands', '');
      await expect(page.getByTestId('player-dock-clear-solo-bands')).toHaveCount(0);

      await miniSpectrum.click({ position: { x: 120, y: 24 } });

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText(/Reference Track/i);
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText('Quick A/B');
      await expect(page.getByTestId('analysis-overlay-jump-previous-track')).toBeVisible();

      const overlayTransportOrder = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.analysis-overlay-transport [data-testid]'))
          .map((element) => (element as HTMLElement).dataset.testid)
          .filter((testid) =>
            testid === 'analysis-overlay-jump-previous-track' ||
            testid === 'analysis-overlay-prev'
          )
      );
      expect(overlayTransportOrder).toEqual([
        'analysis-overlay-prev',
        'analysis-overlay-jump-previous-track',
      ]);
      await expect(page.getByTestId('analysis-overlay-jump-previous-track')).toHaveText('◀◀');
      await expect(
        page.getByTestId('analysis-overlay-prev').locator('.rewind-to-start-icon')
      ).toBeVisible();

      const fullScreenSpectrum = page.getByTestId('spectrum-analyzer-full');
      await expect(fullScreenSpectrum).toBeVisible();
      const fullScreenSpectrumHeight = await fullScreenSpectrum.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height)
      );
      expect(fullScreenSpectrumHeight).toBeGreaterThanOrEqual(250);

      const overlaySectionOrder = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.analysis-overlay-grid > .analysis-overlay-section')).map(
          (element) => (element as HTMLElement).dataset.testid ?? ''
        )
      );

      expect(overlaySectionOrder[0]).toBe('analysis-overlay-visualizations');
      expect(overlaySectionOrder[1]).toBe('analysis-overlay-reference-panel');

      const clearSoloButton = page.getByTestId('analysis-clear-solo-bands');
      await expect(clearSoloButton).toBeVisible();
      await clearSoloButton.click();
      await expect(clearSoloButton).toHaveCount(0);

      await fullScreenSpectrum.click({ position: { x: 120, y: 60 } });
      await expect(clearSoloButton).toBeVisible();
      await clearSoloButton.click();
      await expect(clearSoloButton).toHaveCount(0);

      await page.getByTestId('analysis-modal').click({ position: { x: 8, y: 8 } });
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
