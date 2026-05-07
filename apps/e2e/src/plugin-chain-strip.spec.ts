import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * v3.40 — Phase 1b Plugin chain strip (UI only).
 *
 * Covers:
 *   - Fullscreen mastering overlay renders the chain strip
 *   - "Add" opens the plugin browser dialog
 *   - Picking a plugin appends a pill to the chain
 *   - Toggling a pill flips its aria-checked state
 *   - "×" removes the pill from the chain
 *   - Reopening the track rehydrates the chain (persistence round-trip)
 *
 * We bypass the native `pp-audio-host` sidecar by seeding a fake plugin
 * library through `setUserState`. The renderer treats the cached library
 * as authoritative for rendering (it only hits the sidecar when the user
 * clicks "Scan installed plugins"), so the full flow exercises without needing the
 * compiled JUCE binary to exist in the E2E environment.
 */

async function writeTestWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 3_000;
  const frequencyHz = 440;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(channels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
    const value = Math.max(-1, Math.min(1, sample)) * 0.38;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

const FAKE_LIBRARY = {
  scannedAt: new Date().toISOString(),
  scanVersion: 1,
  plugins: [
    {
      id: 'au:test-fake-limiter',
      name: 'Fake Limiter',
      vendor: 'Test Labs',
      format: 'au' as const,
      version: '1.0.0',
      path: '/Library/Audio/Plug-Ins/Components/FakeLimiter.component',
      categories: ['Dynamics'],
      isSupported: true,
      failureReason: null,
    },
    {
      id: 'vst3:test-fake-eq',
      name: 'Fake EQ',
      vendor: 'Test Labs',
      format: 'vst3' as const,
      version: '2.1.0',
      path: '/Library/Audio/Plug-Ins/VST3/FakeEQ.vst3',
      categories: ['EQ'],
      isSupported: true,
      failureReason: null,
    },
  ],
};

/**
 * Suppress the background plugin scan (which would otherwise overwrite our
 * seeded library with real installed AudioUnits on the test host) and push
 * a deterministic fake library into the renderer via the v3.40 test hook.
 */
async function seedFakePluginLibrary(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as {
        __producerPlayerSetPluginLibrary?: unknown;
      }).__producerPlayerSetPluginLibrary === 'function',
    null,
    { timeout: 10_000 },
  );
  await page.evaluate((library) => {
    (window as unknown as {
      __producerPlayerDisablePluginLibraryBootstrap?: boolean;
      __producerPlayerSetPluginLibrary?: (library: unknown) => void;
    }).__producerPlayerDisablePluginLibraryBootstrap = true;
    (window as unknown as {
      __producerPlayerSetPluginLibrary?: (library: unknown) => void;
    }).__producerPlayerSetPluginLibrary?.(library);
  }, FAKE_LIBRARY);
}

test.describe('Plugin chain strip @smoke', () => {
  test('fullscreen chain strip add/toggle/remove + persistence @smoke', async () => {
    const directories = await createE2ETestDirectories('plugin-chain-strip');

    await writeTestWav(path.join(directories.fixtureDirectory, 'Plugin Chain Test v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      // Suppress the background native scan + seed a deterministic fake
      // library BEFORE selecting a track (so the renderer's chain-load
      // effect sees a populated library when the Add button is clicked).
      await seedFakePluginLibrary(page);

      // --- Link folder + select track -----------------------------------
      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      // Re-seed after track selection to guarantee the fake library wins
      // any race against a scan call that was already in flight at launch.
      await seedFakePluginLibrary(page);

      // --- Open the fullscreen Mastering overlay -------------------------
      await expect(page.getByTestId('analysis-expand-button')).toBeEnabled();
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      // Scenario 1: Fullscreen chain strip is visible + empty state.
      const strip = page.getByTestId('plugin-chain-strip-fullscreen');
      await expect(strip).toBeVisible();
      await expect(strip.getByTestId('plugin-chain-strip-empty')).toBeVisible();

      // Scenario 2: Click Add → browser dialog opens, populated by fake library.
      await strip.getByTestId('plugin-chain-strip-add').click();
      const dialog = page.getByTestId('plugin-browser-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('plugin-browser-dialog-row')).toHaveCount(2);

      // Scenario 3: Pick a plugin → pill appears in the chain.
      await dialog.getByTestId('plugin-browser-dialog-row').first().click();
      await expect(dialog).not.toBeVisible();
      await expect(strip.getByTestId('plugin-pill')).toHaveCount(1);
      await expect(strip.getByTestId('plugin-pill-name').first()).toContainText('Fake Limiter');

      // Scenario 4: Toggle → switch flips aria-checked.
      const toggle = strip.getByTestId('plugin-pill-toggle').first();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(strip.getByTestId('plugin-pill').first()).toHaveAttribute(
        'data-enabled',
        'false',
      );

      // Scenario 5: × removes the pill.
      await strip.getByTestId('plugin-pill-remove').first().click();
      await expect(strip.getByTestId('plugin-pill')).toHaveCount(0);
      await expect(strip.getByTestId('plugin-chain-strip-empty')).toBeVisible();

      // Scenario 6: Re-add two pills, close overlay, reopen → chain persists.
      await strip.getByTestId('plugin-chain-strip-add').click();
      await dialog.getByTestId('plugin-browser-dialog-row').first().click();
      await strip.getByTestId('plugin-chain-strip-add').click();
      await dialog.getByTestId('plugin-browser-dialog-row').nth(1).click();
      await expect(strip.getByTestId('plugin-pill')).toHaveCount(2);

      // Close overlay by pressing Escape (existing mastering-overlay behaviour).
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('analysis-modal')).not.toBeVisible();

      // Reopen — chain should rehydrate from per-track persistence.
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(
        page.getByTestId('plugin-chain-strip-fullscreen').getByTestId('plugin-pill'),
      ).toHaveCount(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
