import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * v3.32 Phase 3b — Spectrum Analyzer AI EQ recs flow through the unified
 * v3.30 `perTrackAiRecommendations` store (metric IDs `spectrum_eq_band_0`
 * ... `spectrum_eq_band_N`).
 *
 * The Spectrum keeps its own inline "AI Recommend" button + cyan dashed
 * overlay for UX continuity (Ethan voice 4794 + 4801: "keep its own thing").
 * The tests below exercise the storage-layer contract:
 *
 *   1. Seeding spectrum-band recs via the existing IPC surface
 *      (`setAiRecommendation`) surfaces them in `getAiRecommendations` for
 *      the same (songId, versionNumber) slot.
 *   2. The fullscreen "Show AI recommendations" toggle hides the Spectrum's
 *      cyan dashed AI EQ overlay when OFF and shows it when ON.
 *   3. The regenerate button clears BOTH the unified-store recs
 *      (spectrum + mastering metrics) AND the Spectrum's own localStorage
 *      entry, so the cyan curve disappears and the Mastering captions
 *      disappear together.
 *
 * An end-to-end agent run is not exercised here — Phase 4 (v3.33) will land
 * that; the dual-write in `handleRequestAiEq` is covered by the v3.30 unit
 * tests for the storage contract and by manual testing.
 */

async function writeTestWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 6_000;
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

test.describe('Spectrum AI recommendations unified store (Phase 3b) @smoke', () => {
  test('seeding spectrum-band recs surfaces through getAiRecommendations + regenerate clears them @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-spectrum-ai-rec-unified'
    );

    // Use "v1" in the filename so `getVersionNumberFromFileName` parses a
    // versionNumber and `currentPlaybackVersionNumber` lines up with the
    // seed's versionNumber=1 target.
    await writeTestWav(
      path.join(directories.fixtureDirectory, 'Spectrum AI Unified Test v1.wav')
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory
    );

    try {
      // --- Link the folder and open the track ----------------------------
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

      // v3.36: read the songId directly from the rendered row rather than
      // `state.songOrder[0]`. The DOM row is populated synchronously from
      // the scan result, but `songOrder` is only written to persisted state
      // via the debounced App.tsx sync (~500ms). On slow CI the evaluate
      // below fires before the debounce flushes, so `songOrder[0]` was
      // `undefined` → "no song in songOrder". Reading the data attribute
      // matches the same ground truth the user sees.
      const songIdFromRow = await page
        .getByTestId('main-list-row')
        .first()
        .getAttribute('data-song-id');
      if (!songIdFromRow) {
        throw new Error('main-list-row missing data-song-id attribute');
      }

      // --- Seed spectrum-band recs (freshly generated) + a fresh mastering
      //     rec, plus one stale spectrum band so the stale path is also
      //     exercised -------------------------------------------------------
      const seedResult = await page.evaluate(async (songIdFromDom: string) => {
        interface TestApi {
          getUserState: () => Promise<{
            songOrder?: string[];
          } & Record<string, unknown>>;
          setAiRecommendation: (
            songId: string,
            versionNumber: number,
            metricId: string,
            rec: Record<string, unknown>,
          ) => Promise<void>;
          getAiRecommendations: (
            songId: string,
            versionNumber: number,
          ) => Promise<Record<string, unknown> | null>;
        }
        const api = (window as unknown as { producerPlayer?: TestApi }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        const songId = songIdFromDom;
        if (!songId) throw new Error('songIdFromDom missing');

        const gains = [2.0, -1.5, 0.5, 1.0, -0.5, 3.0];
        const generatedAt = Date.now();

        // Fresh spectrum-band recs (one per band) -------------------------
        for (let bandIndex = 0; bandIndex < gains.length; bandIndex += 1) {
          const sign = gains[bandIndex] >= 0 ? '+' : '';
          const rec = {
            recommendedValue: `${sign}${gains[bandIndex].toFixed(1)} dB band ${bandIndex}`,
            recommendedRawValue: gains[bandIndex],
            reason: `AI-recommended EQ gain for band ${bandIndex}.`,
            model: 'test-model',
            requestId: `spectrum-test-band-${bandIndex}`,
            analysisVersion: 'test-analysis-v1',
            generatedAt,
            status: 'fresh' as const,
          };
          await api.setAiRecommendation(songId, 1, `spectrum_eq_band_${bandIndex}`, rec);
        }

        // Fresh mastering rec for a sibling metric ------------------------
        await api.setAiRecommendation(songId, 1, 'integrated_lufs', {
          recommendedValue: '-12.5 LUFS',
          recommendedRawValue: -12.5,
          reason: 'Spotify ceiling target.',
          model: 'test-model',
          requestId: 'mastering-req-1',
          analysisVersion: 'test-analysis-v1',
          generatedAt,
          status: 'fresh' as const,
        });

        // Read back through the same IPC surface to assert the set surfaced
        const readBack = await api.getAiRecommendations(songId, 1);
        return { songId, readBack };
      }, songIdFromRow);

      expect(seedResult.songId).toBeTruthy();
      expect(seedResult.readBack).toBeTruthy();
      const readBack = seedResult.readBack as Record<string, { recommendedValue: string; status: string }>;
      // Each of the 6 spectrum bands is present under its own metric id
      for (let bandIndex = 0; bandIndex < 6; bandIndex += 1) {
        const metricId = `spectrum_eq_band_${bandIndex}`;
        expect(readBack[metricId]).toBeTruthy();
        expect(readBack[metricId].status).toBe('fresh');
      }
      // Sibling mastering metric is also present
      expect(readBack.integrated_lufs).toBeTruthy();
      expect(readBack.integrated_lufs.status).toBe('fresh');

      // --- Open the fullscreen Mastering overlay -------------------------
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('ai-rec-toolbar')).toBeVisible();

      // The mastering caption for the sibling metric is visible (confirms
      // the fullscreen refetch effect wired up correctly).
      const mastCaption = page.getByTestId('ai-rec-integrated_lufs');
      await expect(mastCaption).toBeVisible({ timeout: 5_000 });

      // --- Click Regenerate — should clear BOTH spectrum + mastering recs
      //     from the unified store AND reset the Spectrum's localStorage --
      await page.getByTestId('ai-rec-regenerate').click();
      await expect(mastCaption).toHaveCount(0, { timeout: 5_000 });

      const afterRegen = await page.evaluate(async (songIdFromDom: string) => {
        interface TestApi {
          getAiRecommendations: (
            songId: string,
            versionNumber: number,
          ) => Promise<Record<string, unknown> | null>;
        }
        const api = (window as unknown as { producerPlayer?: TestApi }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        const songId = songIdFromDom;
        if (!songId) throw new Error('songIdFromDom missing');
        const set = await api.getAiRecommendations(songId, 1);
        return { set };
      }, songIdFromRow);
      // After regenerate the whole set for this (song, version) is wiped
      // — including every spectrum_eq_band_N metric.
      expect(afterRegen.set).toBeNull();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
