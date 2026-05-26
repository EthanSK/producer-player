import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

async function writeTestWav(filePath: string, frequencyHz: number): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 350;
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
    buffer.writeInt16LE(Math.floor(sample * 0.32 * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

test.describe('Inspector floating tooltips @smoke', () => {
  test('version action tooltip is portalled so drawer overflow cannot clip it @smoke', async () => {
    const directories = await createE2ETestDirectories('producer-player-inspector-tooltip');

    // Two versions under one song are enough to render the inspector Version
    // History actions, including the "Use as reference" button Ethan saw
    // clipped inside the drawer's scroll container.
    await writeTestWav(path.join(directories.fixtureDirectory, 'Tooltip Song v1.wav'), 440);
    await writeTestWav(path.join(directories.fixtureDirectory, 'Tooltip Song v2.wav'), 554.37);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
    try {
      await page.setViewportSize({ width: 1180, height: 760 });

      await page.evaluate(async (folderPath) => {
        await (
          window as unknown as {
            producerPlayer: { linkFolder: (folder: string) => Promise<void> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });
      await page.getByTestId('main-list-row').first().click();

      const inspectorToggle = page.getByTestId('inspector-toggle');
      if (await inspectorToggle.isVisible()) {
        await inspectorToggle.click();
      }

      const useAsReferenceButton = page
        .getByTestId('inspector-version-use-as-reference-button')
        .first();
      await expect(useAsReferenceButton).toBeVisible();
      await useAsReferenceButton.hover();

      const tooltip = page
        .locator('.floating-tooltip-popover')
        .filter({ hasText: 'Use as reference' })
        .first();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveCSS('position', 'fixed');

      // This is the regression guard: the tooltip must not be a descendant of
      // the inspector drawer or scroll region, because either ancestor can clip
      // absolutely-positioned children regardless of z-index.
      await expect(
        tooltip.evaluate((element) => element.parentElement?.tagName),
      ).resolves.toBe('BODY');

      const box = await tooltip.boundingBox();
      const viewport = page.viewportSize();
      expect(box).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
