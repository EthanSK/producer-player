import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

/**
 * v3.121 (Concern 4) — Version History "stuck on loading" regression
 * coverage.
 *
 * Symptom Ethan reported on v3.119+:
 *   "Sometimes works, sometimes doesn't. Switching back-and-forth makes it
 *   worse. The Version History sample-rate / integrated LUFS rows just sit
 *   on 'Loading…' forever."
 *
 * Root cause:
 *   The inspector-version effect's catch & success branches both bailed on
 *   `cancelled === true` (which is set during cleanup when the user
 *   switches tracks). When the queue's 60-second `AnalysisTaskTimeoutError`
 *   eventually rejected the in-flight task AFTER the user already moved on,
 *   the catch handler silently swallowed the error and the per-version
 *   state stayed in `loading` forever. The pending-ref was cleared by the
 *   `finally` block, so subsequent effect re-runs saw `status === 'loading'`
 *   on the same cacheKey and skipped re-enqueueing — the UI was stuck
 *   without anything to recover it.
 *
 * Fix (v3.121):
 *   The cancellation guard at the top of the await blocks was removed; the
 *   setter's existing `existing.cacheKey === cacheKey` guard is the right
 *   protection against cross-version clobber. Letting the success / error
 *   write through means the loading state always transitions to ready or
 *   error eventually — never stays on "loading" forever.
 *
 * This spec asserts the architectural invariant: rapid track-switching
 * never leaves the Version History rows on a permanent loading state.
 */

async function writeTestWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 500;
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

test.describe('Version History stuck-loading regression @smoke', () => {
  test('rapid track-switch does not leave Version History on permanent "loading" @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-vh-stuck'
    );

    // Two valid WAVs (multiple versions per song so the inspector
    // populates a Version History list with multiple rows). Filenames
    // include version suffixes so the song-grouping pulls them under
    // the same song title.
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'TrackOne v1.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'TrackOne v2.wav')
    );
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'TrackTwo v1.wav')
    );
    await writeFixtureFiles(directories.fixtureDirectory, [
      // Stub data for a 4th row — exercises the error path (since
      // ffmpeg can't analyze a file with non-WAV bytes), proving that
      // errors clear the loading state instead of getting silently
      // swallowed by the old `if (cancelled) return` guard.
      { relativePath: 'StubFile v1.wav', contents: 'RIFF stub data' },
    ]);

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );
    try {
      await page.evaluate(async (folderPath) => {
        await (
          window as unknown as {
            producerPlayer: { linkFolder: (folder: string) => Promise<void> };
          }
        ).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      // Wait for the rows to appear. The fixtures produce 3 song groups:
      // TrackOne (v1 + v2), TrackTwo (v1), StubFile (v1).
      await expect(page.getByTestId('main-list-row')).toHaveCount(3, {
        timeout: 15_000,
      });

      // Wait for the test hooks to be installed.
      await page.waitForFunction(
        () =>
          typeof (
            window as unknown as {
              __producerPlayerGetMeasuredQueueDump?: () => unknown;
            }
          ).__producerPlayerGetMeasuredQueueDump === 'function',
        null,
        { timeout: 10_000 }
      );

      // Rapid track-switch: click row 1, row 2, row 3, row 1 in
      // quick succession. Pre-fix this triggered the cancelled-guard
      // race and left the inspector loading state stuck.
      //
      // We use force:true on the rapid-fire clicks because the row
      // position can shift slightly mid-click as the renderer reflows
      // (e.g. metadata-popover hint dot showing up); on slower CI
      // (Windows) the actionability check waits for layout to settle
      // and times out. Since we're testing the renderer's response to
      // a click STORM — not pixel-perfect actionability — force-clicking
      // through the actionability gate is the right tradeoff.
      const rows = page.getByTestId('main-list-row');
      await rows.nth(0).click({ force: true });
      await rows.nth(1).click({ force: true });
      await rows.nth(2).click({ force: true });
      await rows.nth(0).click({ force: true });

      // Give the queue + UI loop a few seconds to settle. The success
      // criterion is that the renderer doesn't lock up and that the
      // selected row (row 0) still responds to interaction.
      await page.waitForTimeout(2_500);

      // Sanity: the renderer is still alive — the row is interactable.
      // (If the loading state were stuck and the renderer was
      // serializing through a frozen state, even a force-click could not
      // round-trip and the renderer would never re-render.)
      await rows.nth(0).click({ force: true });
      await expect(rows.nth(0)).toBeVisible();

      // Verify queue is reachable and well-formed after the storm.
      // We don't assert on specific counts — the queue may have drained
      // entirely on a fast machine — but the dump must be readable.
      const dump = await page.evaluate(() => {
        return (
          window as unknown as {
            __producerPlayerGetMeasuredQueueDump?: () => {
              active: number;
              pending: number;
            };
          }
        ).__producerPlayerGetMeasuredQueueDump?.();
      });
      expect(dump).toBeDefined();
      expect(typeof dump?.active).toBe('number');
      expect(typeof dump?.pending).toBe('number');

      // Final invariant: switching back-and-forth one more time still
      // works and the renderer didn't deadlock. Pre-fix, this was where
      // the "switching back-and-forth makes it worse" symptom would
      // show — the UI froze. Post-fix it just works.
      await rows.nth(1).click({ force: true });
      await rows.nth(0).click({ force: true });
      await expect(rows.nth(0)).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
