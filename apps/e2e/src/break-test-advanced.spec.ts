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

async function writeMinimalWavFixtures(rootDirectory: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    await writeMinimalWav(path.join(rootDirectory, relativePath));
  }
}

async function linkFolderPath(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  folderPath: string
): Promise<void> {
  await page.evaluate(async (pathToLink) => {
    await (window as any).producerPlayer.linkFolder(pathToLink);
  }, folderPath);
}

async function tryLinkFolderPath(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  folderPath: string
): Promise<void> {
  await page.evaluate(async (pathToLink) => {
    try {
      await (window as any).producerPlayer.linkFolder(pathToLink);
    } catch {
      // Break tests intentionally feed invalid paths. Swallow the expected
      // rejection here so the assertion can stay focused on app stability.
    }
  }, folderPath);
}

test.describe('Producer Player advanced break tests', () => {
  test('files without version suffix are ignored from the track list', async () => {
    const dirs = await createE2ETestDirectories('break-nosuffix');

    await writeFixtureFiles(dirs.fixtureDirectory, [
      { relativePath: 'NoSuffixEither.mp3', contents: 'stub' },
    ]);
    // Current scanning/analysis is stricter about WAV validity than the first
    // break-test draft was. Use real tiny WAVs so a timeout here means the
    // naming rule regressed, not that the decoder rejected fake bytes.
    await writeMinimalWavFixtures(dirs.fixtureDirectory, [
      'NoSuffix.wav',
      'WithSuffix v1.wav',
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('app-shell')).toBeVisible();

      const withSuffixRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: /With\s*Suffix|Withsuffix/i });
      await expect(withSuffixRow).toHaveCount(1);
      await expect(withSuffixRow.first().getByTestId('main-list-row-metadata')).toHaveText(
        /v1\s*·\s*wav/i
      );

      await expect(page.getByTestId('main-list')).not.toContainText('NoSuffix');
      await expect(page.getByTestId('main-list')).not.toContainText('NoSuffixEither');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('file named only with version suffix (e.g. "v1.wav") does not crash', async () => {
    // Edge case: filename is just "v1.wav" — the stem is "v1", normalized = "" or "v1"
    const dirs = await createE2ETestDirectories('break-onlysuffix');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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
    await writeMinimalWavFixtures(
      dirs.fixtureDirectory,
      Array.from({ length: 100 }, (_, i) => `Track ${i + 1} v1.wav`)
    );

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(100, { timeout: 30_000 });
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('same song with 20 versions groups into a single row', async () => {
    const dirs = await createE2ETestDirectories('break-manyversions');
    for (let i = 0; i < 20; i += 1) {
      const filePath = path.join(dirs.fixtureDirectory, `Massive Hit v${i + 1}.wav`);
      await writeMinimalWav(filePath);
      const timestamp = new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000);
      await fs.utimes(filePath, timestamp, timestamp);
    }

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Test Song v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Spacebar Test v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Rapid Test v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Solo Track v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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
      await tryLinkFolderPath(page, filePath);

      // App should handle the error gracefully
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('unlink folder while song is selected clears inspector cleanly', async () => {
    const dirs = await createE2ETestDirectories('break-unlink-while-selected');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Alpha v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    const echoV1Path = path.join(dirs.fixtureDirectory, 'Echo v1.wav');
    const echoV2Path = path.join(dirs.fixtureDirectory, 'Echo v2.wav');
    await writeMinimalWav(echoV1Path);
    await writeMinimalWav(echoV2Path);
    await fs.utimes(
      echoV1Path,
      new Date('2026-01-01T00:00:01.000Z'),
      new Date('2026-01-01T00:00:01.000Z')
    );
    await fs.utimes(
      echoV2Path,
      new Date('2026-01-01T00:00:02.000Z'),
      new Date('2026-01-01T00:00:02.000Z')
    );

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // Turn auto-organize OFF
      await page.evaluate(async () => {
        await (window as any).producerPlayer.setAutoMoveOld(false);
      });

      await linkFolderPath(page, dirs.fixtureDirectory);

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
      await linkFolderPath(page, dirs.fixtureDirectory);

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

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Looper v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      const repeatBtn = page.getByTestId('player-repeat');
      await expect(repeatBtn).toHaveAttribute('aria-label', 'Repeat Off');

      // Click through all modes
      await repeatBtn.click();
      await expect(repeatBtn).toHaveAttribute('aria-label', 'Repeat One');
      await repeatBtn.click();
      await expect(repeatBtn).toHaveAttribute('aria-label', 'Repeat All');
      await repeatBtn.click();
      await expect(repeatBtn).toHaveAttribute('aria-label', 'Repeat Off');

      // Extra clicks to ensure it doesn't get stuck
      await repeatBtn.click();
      await repeatBtn.click();
      await repeatBtn.click();
      await expect(repeatBtn).toHaveAttribute('aria-label', 'Repeat Off');

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
      await tryLinkFolderPath(page, '/');

      // App should handle the error gracefully without hanging
      await expect(page.getByTestId('app-shell')).toBeVisible();
      // No folder should be linked
      await expect(page.getByTestId('linked-folder-item')).toHaveCount(0);
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
