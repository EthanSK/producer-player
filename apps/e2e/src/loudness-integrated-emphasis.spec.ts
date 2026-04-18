import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * Integrated LUFS is the headline streaming-normalization measurement in the
 * Loudness & Peaks section. It is visually emphasized via the
 * `.loudness-metric--primary` modifier: an accent-coloured border, a subtle
 * background tint, a larger readout value, and an uppercase "INTEGRATED"
 * eyebrow label. This spec asserts the emphasis holds in BOTH the compact
 * side panel and the fullscreen mastering overlay so the two views stay in
 * sync.
 */

async function writeTestWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 8_000;
  const frequencyHz = 440;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.38;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

test.describe('loudness integrated emphasis', () => {
  test('Integrated LUFS is visually emphasized in compact + fullscreen views', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-loudness-integrated-emphasis'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Emphasis Test v1.wav')
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );

    try {
      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;

        if (!api) {
          throw new Error('producerPlayer API unavailable in test window');
        }

        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      // --- Compact side-panel assertions -----------------------------------
      const compactCard = page.getByTestId('analysis-integrated-stat');
      await expect(compactCard).toBeVisible();
      await expect(compactCard).toHaveClass(/loudness-metric--primary/);
      await expect(compactCard).toHaveAttribute('data-emphasized', 'true');
      await expect(compactCard).toHaveAttribute(
        'aria-label',
        /primary loudness measurement/i
      );
      await expect(
        compactCard.locator('.loudness-metric-eyebrow')
      ).toHaveText(/integrated/i);

      const compactFontSizes = await page.evaluate(() => {
        const primaryCard = document.querySelector(
          '[data-testid="analysis-integrated-stat"]'
        ) as HTMLElement | null;
        const primaryStrong = primaryCard?.querySelector(
          'strong'
        ) as HTMLElement | null;
        const supportingCard = document.querySelector(
          '[data-testid="analysis-short-term-stat"]'
        ) as HTMLElement | null;
        const supportingStrong = supportingCard?.querySelector(
          'strong'
        ) as HTMLElement | null;

        const parseSize = (element: HTMLElement | null): number => {
          if (!element) return 0;
          return Number.parseFloat(getComputedStyle(element).fontSize);
        };

        const parseBorderColor = (element: HTMLElement | null): string => {
          if (!element) return '';
          return getComputedStyle(element).borderTopColor;
        };

        return {
          primarySize: parseSize(primaryStrong),
          supportingSize: parseSize(supportingStrong),
          primaryBorder: parseBorderColor(primaryCard),
          supportingBorder: parseBorderColor(supportingCard),
        };
      });

      expect(compactFontSizes.primarySize).toBeGreaterThan(
        compactFontSizes.supportingSize
      );
      // Border colour on the emphasized row must not match the plain stat
      // card border — confirms the accent outline applied.
      expect(compactFontSizes.primaryBorder).not.toBe(
        compactFontSizes.supportingBorder
      );

      // --- Fullscreen mastering overlay assertions -------------------------
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(
        page.getByTestId('analysis-overlay-loudness-peaks')
      ).toBeVisible();

      const overlayCard = page.getByTestId('analysis-overlay-integrated-stat');
      await expect(overlayCard).toBeVisible();
      await expect(overlayCard).toHaveClass(/loudness-metric--primary/);
      await expect(overlayCard).toHaveAttribute('data-emphasized', 'true');
      await expect(overlayCard).toHaveAttribute(
        'aria-label',
        /primary loudness measurement/i
      );
      await expect(
        overlayCard.locator('.loudness-metric-eyebrow')
      ).toHaveText(/integrated/i);

      const overlayFontSizes = await page.evaluate(() => {
        const gridSelector =
          '[data-testid="analysis-overlay-loudness-peaks"] .analysis-overlay-loudness-peaks-grid';
        const grid = document.querySelector(gridSelector) as HTMLElement | null;
        if (!grid) {
          return null;
        }

        const primaryCard = grid.querySelector(
          '[data-testid="analysis-overlay-integrated-stat"]'
        ) as HTMLElement | null;
        const primaryStrong = primaryCard?.querySelector(
          'strong'
        ) as HTMLElement | null;

        const allCards = Array.from(
          grid.querySelectorAll('.analysis-stat-card')
        ) as HTMLElement[];
        const supportingCard =
          allCards.find(
            (card) => !card.classList.contains('loudness-metric--primary')
          ) ?? null;
        const supportingStrong = supportingCard?.querySelector(
          'strong'
        ) as HTMLElement | null;

        const parseSize = (element: HTMLElement | null): number => {
          if (!element) return 0;
          return Number.parseFloat(getComputedStyle(element).fontSize);
        };

        const parseBorderColor = (element: HTMLElement | null): string => {
          if (!element) return '';
          return getComputedStyle(element).borderTopColor;
        };

        return {
          primarySize: parseSize(primaryStrong),
          supportingSize: parseSize(supportingStrong),
          primaryBorder: parseBorderColor(primaryCard),
          supportingBorder: parseBorderColor(supportingCard),
        };
      });

      expect(overlayFontSizes).not.toBeNull();
      expect(overlayFontSizes!.primarySize).toBeGreaterThan(
        overlayFontSizes!.supportingSize
      );
      expect(overlayFontSizes!.primaryBorder).not.toBe(
        overlayFontSizes!.supportingBorder
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
