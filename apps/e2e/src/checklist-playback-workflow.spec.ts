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
        .toBeLessThanOrEqual(expectedSeconds + 0.2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('set now captures checklist timestamp and matching items flash when playback reaches them', async () => {
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
      await expect.poll(async () => {
        const className = await page.locator('.checklist-item-row').first().getAttribute('class');
        return className ?? '';
      }).toContain('is-active');
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

  test('adding checklist items does not auto-scroll the checklist dialog', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-no-auto-scroll-on-add'
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
        await input.fill(`Auto-scroll baseline ${index}`);
        await addButton.click();
      }

      const scrollRegion = page.getByTestId('song-checklist-scroll-region');
      await scrollRegion.evaluate((node) => {
        (node as HTMLDivElement).scrollTop = 120;
      });

      const scrollTopBeforeAdd = await scrollRegion.evaluate(
        (node) => (node as HTMLDivElement).scrollTop
      );

      await input.fill('Auto-scroll should stay put');
      await addButton.click();

      await expect
        .poll(async () => scrollRegion.evaluate((node) => (node as HTMLDivElement).scrollTop))
        .toBeLessThan(scrollTopBeforeAdd + 30);

      await expect
        .poll(async () => scrollRegion.evaluate((node) => (node as HTMLDivElement).scrollTop))
        .toBeGreaterThan(scrollTopBeforeAdd - 30);
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

  test('checklist mini-player next/previous reinitialize the checklist to the moved song', async () => {
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

      const checklistInput = page.getByTestId('song-checklist-input');
      await checklistInput.fill('draft for current song');

      await page.getByTestId('song-checklist-mini-player-next').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${secondSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${secondSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('');

      await checklistInput.fill('draft for moved song');

      await page.getByTestId('song-checklist-mini-player-prev').click();
      await expect(page.getByTestId('player-track-name')).toContainText(`${firstSongTitle} v1.wav`);
      await expect(page.locator('.checklist-modal-header h2')).toContainText(
        `${firstSongTitle} Checklist`
      );
      await expect(checklistInput).toHaveValue('');
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
        'Reference Track'
      );
      await expect(page.getByTestId('analysis-overlay-spectrum-heading')).toContainText(
        'Reference Track'
      );
      await expect(page.getByTestId('analysis-overlay-tonal-balance')).toHaveAttribute(
        'data-source',
        'reference-track'
      );
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
      durationMs: 3_000,
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

      await miniSpectrum.click({ position: { x: 120, y: 24 } });

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText(/Reference Track/i);
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText('Quick A/B');

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
