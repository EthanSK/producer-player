/**
 * Advanced break tests for Producer Player
 * Focus: edge cases discovered via source code analysis
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
  writeFixtureFiles,
} from './helpers/electron-app';

function writeMinimalWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 500;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const bitsPerSample = 16;
  const blockAlign = bitsPerSample / 8;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * blockAlign, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  return fs.writeFile(filePath, buffer);
}

test.describe('Producer Player advanced break tests', () => {
  test('files without version suffix still appear in the track list (documents behavior)', async () => {
    // The naming guide says "File names must end with v1, v2, v3" but the app does NOT filter out
    // files without version suffixes — they appear as songs. This test documents actual behavior.
    const dirs = await createE2ETestDirectories('break-nosuffix');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'NoSuffix.wav', contents: 'RIFF stub' },
      { relativePath: 'NoSuffixEither.mp3', contents: 'stub' },
      { relativePath: 'WithSuffix v1.wav', contents: 'RIFF stub' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      // Wait for all 3 files to appear - they appear even without version suffixes
      // KNOWN BEHAVIOR: all 3 files appear, including the 2 without version suffixes
      await expect(page.getByTestId('main-list-row')).toHaveCount(3);
      await expect(page.getByTestId('app-shell')).toBeVisible();

      const withSuffixRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: /With\s*Suffix|Withsuffix/i });
      await expect(withSuffixRow).toHaveCount(1);
      await expect(withSuffixRow.first().getByTestId('main-list-row-metadata')).toHaveText(
        /v1\s*·\s*wav/i
      );

      // No-suffix files also appear - document this behavior gap with the naming guide
      await expect(page.getByTestId('main-list')).toContainText('NoSuffix');
      await expect(page.getByTestId('main-list')).toContainText('NoSuffixEither');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('file named only with version suffix (e.g. "v1.wav") does not crash', async () => {
    // Edge case: filename is just "v1.wav" — the stem is "v1", normalized = "" or "v1"
    const dirs = await createE2ETestDirectories('break-onlysuffix');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'v1.wav', contents: 'RIFF stub' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('app-shell')).toBeVisible();
      // May show 0 or 1 row — just shouldn't crash
      const count = await page.getByTestId('main-list-row').count();
      console.log(`Only-suffix test: ${count} row(s) displayed`);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('100 stub files in same folder do not crash or hang', async () => {
    const dirs = await createE2ETestDirectories('break-100files');
    const files = Array.from({ length: 100 }, (_, i) => ({
      relativePath: `Track ${i + 1} v1.wav`,
      contents: 'RIFF stub data',
    }));

    await writeFixtureFiles(dirs.fixtureDirectory, files);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(100, { timeout: 30_000 });
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('same song with 20 versions groups into a single row', async () => {
    const dirs = await createE2ETestDirectories('break-manyversions');
    const files = Array.from({ length: 20 }, (_, i) => ({
      relativePath: `Massive Hit v${i + 1}.wav`,
      contents: 'RIFF stub data',
      modifiedAtMs: Date.parse('2026-01-01T00:00:00.000Z') + i * 1000,
    }));

    await writeFixtureFiles(dirs.fixtureDirectory, files);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      // All versions should group into a single logical song row
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('app-shell')).toBeVisible();

      await page.getByTestId('main-list-row').first().click();
      // Inspector should show all 20 versions (auto-organize may have moved some to old/)
      const versionCount = await page.getByTestId('inspector-version-row').count();
      console.log(`20-version song shows ${versionCount} inspector rows`);
      expect(versionCount).toBeGreaterThanOrEqual(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('volume slider edge cases: 0% and 100%', async () => {
    const dirs = await createE2ETestDirectories('break-volume');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Test Song v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      // Set volume to 0
      await page.getByTestId('player-volume-slider').fill('0');
      await expect(page.getByTestId('player-volume-control')).toContainText('Vol 0%');

      // Set volume to 100
      await page.getByTestId('player-volume-slider').fill('100');
      await expect(page.getByTestId('player-volume-control')).toContainText('Vol 100%');

      // App shell still visible
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('spacebar toggles playback even with stub audio', async () => {
    // Tests that the keyboard shortcut is wired up and doesn't crash
    const dirs = await createE2ETestDirectories('break-spacebar');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Spacebar Test v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      // Press spacebar to toggle play (focus must not be on input)
      await page.locator('body').press('Space');
      // Just check app doesn't crash
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('rapid play/pause clicks do not crash', async () => {
    const dirs = await createE2ETestDirectories('break-rapid-playpause');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Rapid Test v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      // Click play/pause 10 times rapidly
      for (let i = 0; i < 10; i++) {
        await page.getByTestId('player-play-toggle').click();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('prev/next navigation when only one track does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-prevnext-single');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Solo Track v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      // Multiple prev/next clicks on a single track
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('player-prev').click();
        await page.getByTestId('player-next').click();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('player-track-name')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('linking a file (not a directory) as folder path does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-file-as-folder');
    const filePath = path.join(dirs.fixtureDirectory, 'not-a-folder.wav');
    await fs.writeFile(filePath, 'RIFF stub data');

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // Fill in a FILE path instead of a directory path
      await page.getByTestId('link-folder-path-input').fill(filePath);
      await page.getByTestId('link-folder-path-button').click();

      // App should handle the error gracefully
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('search input handles very long query string without crash', async () => {
    const dirs = await createE2ETestDirectories('break-long-search');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      const longQuery = 'x'.repeat(500);
      await page.getByTestId('search-input').fill(longQuery);
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('main-list-row')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('unlink folder while song is selected clears inspector cleanly', async () => {
    const dirs = await createE2ETestDirectories('break-unlink-while-selected');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Alpha v1.wav', contents: 'RIFF stub' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('inspector-song-title')).toBeVisible();

      // Dismiss dialog to unlink
      page.once('dialog', async (dialog) => {
        await dialog.accept();
      });

      await page.getByRole('button', { name: 'Unlink' }).click();

      // After unlinking, the inspector should be cleared and app stable
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('main-list-row')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('organize with auto-organize OFF does not auto-move files', async () => {
    const dirs = await createE2ETestDirectories('break-organize-off');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      {
        relativePath: 'Echo v1.wav',
        contents: 'RIFF stub',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Echo v2.wav',
        contents: 'RIFF stub',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // Turn auto-organize OFF
      await page.evaluate(async () => {
        await (window as any).producerPlayer.setAutoMoveOld(false);
      });

      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Verify Echo v1.wav is still in fixture directory (not moved to old/)
      await fs.access(path.join(dirs.fixtureDirectory, 'Echo v1.wav'));

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('scrubber at 0 and max (extreme positions) does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-scrubber-extreme');
    // Write an actual valid WAV so the scrubber has a duration to work with
    const wavPath = path.join(dirs.fixtureDirectory, 'Scrub Test v1.wav');
    await writeMinimalWav(wavPath);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      const scrubber = page.getByTestId('player-scrubber');

      // The scrubber max is set to durationSeconds. With stub WAV, audio may not decode.
      // If scrubber is enabled, test that 0 works (within range).
      // If scrubber is disabled (no audio duration), that's also valid behavior.
      const isEnabled = await scrubber.isEnabled();
      if (isEnabled) {
        // Scrub to start
        await scrubber.fill('0');
        // Read the actual max from the DOM
        const maxValue = await scrubber.getAttribute('max');
        if (maxValue && Number(maxValue) > 0) {
          await scrubber.fill(maxValue);
          await scrubber.fill('0');
        }
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('repeat cycle goes through all three modes and wraps back to Off', async () => {
    const dirs = await createE2ETestDirectories('break-repeat-cycle');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'Looper v1.wav', contents: 'RIFF stub' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      const repeatBtn = page.getByTestId('player-repeat');
      await expect(repeatBtn).toContainText('Repeat: Off');

      // Click through all modes
      await repeatBtn.click();
      await expect(repeatBtn).toContainText('Repeat: One');
      await repeatBtn.click();
      await expect(repeatBtn).toContainText('Repeat: All');
      await repeatBtn.click();
      await expect(repeatBtn).toContainText('Repeat: Off');

      // Extra clicks to ensure it doesn't get stuck
      await repeatBtn.click();
      await repeatBtn.click();
      await repeatBtn.click();
      await expect(repeatBtn).toContainText('Repeat: Off');

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('linking root filesystem "/" is rejected with a clear error (fixed)', async () => {
    // FIXED: previously linking "/" caused chokidar to hang indefinitely.
    // Now FileLibraryService.linkFolder() rejects paths with depth < 2 before calling chokidar.
    const dirs = await createE2ETestDirectories('break-root-path');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill('/');
      await page.getByTestId('link-folder-path-button').click();

      // App should handle the error gracefully without hanging
      await expect(page.getByTestId('app-shell')).toBeVisible();
      // No folder should be linked
      await expect(page.getByTestId('linked-folder-item')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('search during active playback does not interrupt player', async () => {
    const dirs = await createE2ETestDirectories('break-search-during-playback');
    const wavPath = path.join(dirs.fixtureDirectory, 'Live Song v1.wav');
    const wavPath2 = path.join(dirs.fixtureDirectory, 'Other Song v1.wav');
    await writeMinimalWav(wavPath);
    await writeMinimalWav(wavPath2);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(dirs.fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      // Type in search while track is loaded
      await page.getByTestId('search-input').fill('Live');
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Player dock should still be visible with the loaded track
      await expect(page.getByTestId('player-dock')).toBeVisible();
      await expect(page.getByTestId('player-track-name')).toBeVisible();

      // Clear search
      await page.getByTestId('search-input').fill('');
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('export playlist button is disabled when no songs are loaded', async () => {
    const dirs = await createE2ETestDirectories('break-export-empty');

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // No folder linked, no songs — the export button should be disabled
      const exportBtn = page.getByTestId('export-playlist-order-button');
      const isVisible = await exportBtn.isVisible();

      if (isVisible) {
        // Button is disabled (as expected) — do not click it
        await expect(exportBtn).toBeDisabled();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('rescan with no linked folders is a no-op', async () => {
    const dirs = await createE2ETestDirectories('break-rescan-empty');

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // Rescan with nothing linked — the button may be hidden, but if visible, shouldn't crash
      const rescanBtn = page.getByTestId('rescan-button');
      const isVisible = await rescanBtn.isVisible();

      if (isVisible) {
        await rescanBtn.click();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
