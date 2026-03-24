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

  test('paused preview wheel scrubs the checklist timestamp and matching items flash when playback reaches them', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-preview-scroll-highlight'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 4_200,
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
      await waitForPlaybackSeconds(page, 1.1);
      await page.getByTestId('song-checklist-play-toggle').click();

      const previewBadge = page.getByTestId('song-checklist-input-timestamp-preview');
      await previewBadge.hover();
      await page.mouse.wheel(0, 120);
      await expect(previewBadge).toHaveText('0:02');

      await page.getByTestId('song-checklist-input').fill('Bass pocket');
      await page.getByTestId('song-checklist-add').click();
      await expect(page.getByTestId('song-checklist-item-timestamp').first()).toHaveText('0:02');

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

  test('checklist and mastering fullscreen buttons let you jump between both views', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-mastering-fullscreen-jump'
    );
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 3_600,
      frequencyHz: 420,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');

      await page.getByTestId('transport-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      await page.getByTestId('song-checklist-open-mastering').click();
      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toBeVisible();

      await page.getByTestId('analysis-open-checklist-button').click();
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await expect(page.locator('.checklist-modal-header h2')).toContainText('Track A Checklist');
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

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText(/Reference track/i);
      await expect(page.getByTestId('analysis-overlay-reference-panel')).toContainText('Quick A/B');

      const overlaySectionOrder = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.analysis-overlay-grid > .analysis-overlay-section')).map(
          (element) => (element as HTMLElement).dataset.testid ?? ''
        )
      );

      expect(overlaySectionOrder[0]).toBe('analysis-overlay-visualizations');
      expect(overlaySectionOrder[1]).toBe('analysis-overlay-reference-panel');

      await page.getByTestId('spectrum-analyzer-full').click({ position: { x: 120, y: 60 } });
      await expect(page.getByTestId('analysis-clear-solo-bands')).toBeVisible();
      await page.getByTestId('analysis-clear-solo-bands').click();
      await expect(page.getByTestId('analysis-clear-solo-bands')).toHaveCount(0);

      await page.getByTestId('analysis-modal').click({ position: { x: 8, y: 8 } });
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
