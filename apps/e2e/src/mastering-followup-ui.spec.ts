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
  options: { frequencyHz?: number; durationMs?: number } = {}
): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = options.durationMs ?? 8_000;
  const frequencyHz = options.frequencyHz ?? 440;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
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
  buffer.writeUInt32LE(sampleRate * blockAlign, offset);
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

test.describe('mastering follow-up UI regressions', () => {
  test('toggles compact metrics and keeps platform icon/title on one top row', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const proofDir = path.join(
      workspaceRoot,
      'artifacts/manual-verification/2026-03-24'
    );
    const panelScreenshotPath = path.join(
      proofDir,
      'mastering-followup-panel.png'
    );
    const overlayScreenshotPath = path.join(
      proofDir,
      'mastering-followup-overlay.png'
    );

    await fs.mkdir(proofDir, { recursive: true });

    const directories = await createE2ETestDirectories('producer-player-mastering-followup');

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Mastering Follow-up v1.wav')
    );

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

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
      await page
        .getByTestId('inspector-version-row')
        .first()
        .getByRole('button', { name: 'Cue' })
        .click();

      await expect(page.getByTestId('analysis-track-label')).toContainText('Mastering Follow-up v1.wav');
      await expect(
        page.getByTestId('analysis-integrated-stat').locator('strong')
      ).not.toContainText('Loading', { timeout: 12_000 });

      const compactMetricsToggle = page.getByTestId('analysis-stats-expander');
      await expect(compactMetricsToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('analysis-lra-stat')).toBeHidden();
      await expect(page.getByTestId('analysis-max-short-term-stat')).toBeHidden();
      await expect(page.getByTestId('analysis-max-momentary-stat')).toBeHidden();

      await compactMetricsToggle.click();
      await expect(compactMetricsToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('analysis-lra-stat')).toBeVisible();
      await expect(page.getByTestId('analysis-max-short-term-stat')).toBeVisible();
      await expect(page.getByTestId('analysis-max-momentary-stat')).toBeVisible();

      await compactMetricsToggle.click();
      await expect(compactMetricsToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('analysis-lra-stat')).toBeHidden();
      await expect(page.getByTestId('analysis-max-short-term-stat')).toBeHidden();
      await expect(page.getByTestId('analysis-max-momentary-stat')).toBeHidden();

      const panelLayout = await page.evaluate(() => {
        const button = document.querySelector(
          '[data-testid="analysis-platform-spotify"]'
        ) as HTMLElement | null;
        const title = button?.querySelector('.analysis-platform-title') as HTMLElement | null;
        const icon = button?.querySelector('.analysis-platform-icon') as HTMLElement | null;

        if (!button || !title || !icon) {
          return null;
        }

        const buttonRect = button.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();

        return {
          sameTopRow: Math.abs(titleRect.top - iconRect.top) <= 6,
          titleToRightOfIcon: titleRect.left >= iconRect.right - 2,
          iconNearLeftEdge: iconRect.left - buttonRect.left <= 14,
        };
      });

      expect(panelLayout).not.toBeNull();
      expect(panelLayout?.sameTopRow).toBe(true);
      expect(panelLayout?.titleToRightOfIcon).toBe(true);
      expect(panelLayout?.iconNearLeftEdge).toBe(true);

      await page.screenshot({ path: panelScreenshotPath, fullPage: true });
      await test.info().attach('mastering-followup-panel', {
        path: panelScreenshotPath,
        contentType: 'image/png',
      });

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      const overlayLayout = await page.evaluate(() => {
        const button = document.querySelector(
          '[data-testid="analysis-overlay-platform-spotify"]'
        ) as HTMLElement | null;
        const title = button?.querySelector('.analysis-platform-title') as HTMLElement | null;
        const icon = button?.querySelector('.analysis-platform-icon') as HTMLElement | null;

        if (!button || !title || !icon) {
          return null;
        }

        const buttonRect = button.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();

        return {
          sameTopRow: Math.abs(titleRect.top - iconRect.top) <= 6,
          titleToRightOfIcon: titleRect.left >= iconRect.right - 2,
          iconNearLeftEdge: iconRect.left - buttonRect.left <= 14,
        };
      });

      expect(overlayLayout).not.toBeNull();
      expect(overlayLayout?.sameTopRow).toBe(true);
      expect(overlayLayout?.titleToRightOfIcon).toBe(true);
      expect(overlayLayout?.iconNearLeftEdge).toBe(true);

      await page.screenshot({ path: overlayScreenshotPath, fullPage: true });
      await test.info().attach('mastering-followup-overlay', {
        path: overlayScreenshotPath,
        contentType: 'image/png',
      });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
