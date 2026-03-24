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

type OverflowIssue = {
  selector: string;
  testId: string | null;
  className: string;
  overflowX: number;
  overflowY: number;
  width: number;
  height: number;
};

test.describe('normalization layout', () => {
  test('keeps platform icon/title on one top row and avoids overflow in panel + overlay', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const proofDir = path.join(
      workspaceRoot,
      'artifacts/manual-verification/2026-03-19'
    );
    const panelScreenshotPath = path.join(
      proofDir,
      'normalization-layout-panel.png'
    );
    const overlayScreenshotPath = path.join(
      proofDir,
      'normalization-layout-overlay.png'
    );

    await fs.mkdir(proofDir, { recursive: true });

    const directories = await createE2ETestDirectories(
      'producer-player-normalization-layout'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Normalization Layout v1.wav')
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
      await expect(page.getByTestId('analysis-normalization-panel')).toBeVisible();

      await expect(
        page.getByTestId('analysis-normalization-projected').locator('strong')
      ).not.toContainText('Loading', { timeout: 12_000 });

      // Icon should stay top-left, with title on the same top row.
      const platformTitleLayout = await page.evaluate(() => {
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

      expect(platformTitleLayout).not.toBeNull();
      expect(platformTitleLayout?.sameTopRow).toBe(true);
      expect(platformTitleLayout?.titleToRightOfIcon).toBe(true);
      expect(platformTitleLayout?.iconNearLeftEdge).toBe(true);

      const panelGridColumns = await page.evaluate(() => {
        const platformGrid = document.querySelector(
          '[data-testid="analysis-normalization-panel"] .analysis-platform-grid'
        ) as HTMLElement | null;
        const metricGrid = document.querySelector(
          '[data-testid="analysis-normalization-panel"] .analysis-normalization-inline'
        ) as HTMLElement | null;

        const countColumns = (element: HTMLElement | null): number => {
          if (!element) return 0;
          return getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
        };

        return {
          platformColumns: countColumns(platformGrid),
          metricColumns: countColumns(metricGrid),
        };
      });

      expect(panelGridColumns.platformColumns).toBe(2);
      expect(panelGridColumns.metricColumns).toBe(2);

      await page.screenshot({ path: panelScreenshotPath, fullPage: true });
      await test.info().attach('normalization-layout-panel', {
        path: panelScreenshotPath,
        contentType: 'image/png',
      });

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-normalization-panel')).toBeVisible();

      const overlayGridColumns = await page.evaluate(() => {
        const platformGrid = document.querySelector(
          '[data-testid="analysis-overlay-normalization-panel"] .analysis-platform-grid-overlay'
        ) as HTMLElement | null;
        const metricGrid = document.querySelector(
          '[data-testid="analysis-overlay-normalization-panel"] .analysis-normalization-metrics-grid'
        ) as HTMLElement | null;

        const countColumns = (element: HTMLElement | null): number => {
          if (!element) return 0;
          return getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
        };

        return {
          platformColumns: countColumns(platformGrid),
          metricColumns: countColumns(metricGrid),
        };
      });

      expect(overlayGridColumns.platformColumns).toBe(2);
      expect(overlayGridColumns.metricColumns).toBe(2);

      const overflowIssues = await page.evaluate(() => {
        const selectors = [
          '[data-testid="analysis-normalization-panel"] .analysis-platform-button',
          '[data-testid="analysis-normalization-panel"] .analysis-normalization-inline .analysis-stat-card',
          '[data-testid="analysis-overlay-normalization-panel"] .analysis-platform-button',
          '[data-testid="analysis-overlay-normalization-panel"] .analysis-normalization-metrics-grid .analysis-stat-card',
        ];

        const issues: OverflowIssue[] = [];

        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
          for (const element of elements) {
            const rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) {
              continue;
            }

            const overflowX = Math.max(0, element.scrollWidth - element.clientWidth);
            const overflowY = Math.max(0, element.scrollHeight - element.clientHeight);

            if (overflowX > 1 || overflowY > 1) {
              issues.push({
                selector,
                testId: element.getAttribute('data-testid'),
                className: element.className,
                overflowX,
                overflowY,
                width: rect.width,
                height: rect.height,
              });
            }
          }
        }

        return issues;
      });

      expect(overflowIssues).toEqual([]);

      await page.screenshot({ path: overlayScreenshotPath, fullPage: true });
      await test.info().attach('normalization-layout-overlay', {
        path: overlayScreenshotPath,
        contentType: 'image/png',
      });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
