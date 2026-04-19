import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * v3.31 — Phase 3a of the AI recommendations chain.
 *
 * The fullscreen Mastering view gains:
 *   - A "Show AI recommendations" toggle (default ON).
 *   - A "Regenerate AI recommendations" stub button (clears stored recs for
 *     the current track/version so Phase 4's auto-run in v3.33 just works).
 *   - A light-blue per-metric caption under each stat card / checklist row.
 *     The caption hides when no recommendation exists so the layout never
 *     shifts. Stale recs render with strikethrough + "(stale)" suffix.
 *
 * These scenarios exercise the UI surface; Phase 4 (v3.33) will land the
 * real agent call. For now the data arrives through the IPC surface (either
 * via this test's seed step or via real agent writes later).
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

test.describe('AI recommendations fullscreen UI @smoke', () => {
  test('toggle + regenerate visible, toggling hides/shows seeded recs, stale renders strikethrough @smoke', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-ai-recommendations-ui'
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'AI Rec Test v1.wav')
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

      // --- Disable the auto-run gate so the seeded recs aren't overwritten
      // --- by a Phase 4 real agent call that happens to fire mid-test.
      // --- Then wait until the renderer has computed an analysisVersion for
      // --- the opened track (required so our "fresh" seed uses the same
      // --- fingerprint the Phase 4 auto-stale effect will compare against —
      // --- otherwise it would flip our fresh rec to stale immediately).
      await page.waitForFunction(
        () =>
          typeof (window as unknown as {
            __producerPlayerSetAutoRecommend?: (enabled: boolean) => void;
          }).__producerPlayerSetAutoRecommend === 'function' &&
          typeof (window as unknown as {
            __producerPlayerGetAnalysisVersion?: () => string | null;
          }).__producerPlayerGetAnalysisVersion === 'function',
        null,
        { timeout: 10_000 },
      );
      await page.evaluate(() => {
        const setter = (window as unknown as {
          __producerPlayerSetAutoRecommend?: (enabled: boolean) => void;
        }).__producerPlayerSetAutoRecommend;
        setter?.(false);
      });
      const analysisVersion = await page.waitForFunction(
        () => {
          const fn = (window as unknown as {
            __producerPlayerGetAnalysisVersion?: () => string | null;
          }).__producerPlayerGetAnalysisVersion;
          const v = fn?.();
          return typeof v === 'string' && v.length > 0 ? v : null;
        },
        null,
        { timeout: 15_000 },
      );
      const analysisVersionString = (await analysisVersion.jsonValue()) as string;

      // --- Seed a fresh rec + a stale rec directly via the IPC surface ---
      // Both belong to the currently playing (songId, versionNumber) pair
      // so they render as captions under the corresponding stat cards.
      // Seeding BEFORE opening the fullscreen overlay guarantees the
      // `analysisExpanded` refetch effect picks up the seeded values —
      // setAiRecommendation does not push USER_STATE_CHANGED by design
      // (the IPC surface is authoritative; Phase 4 wires real-time sync).
      //
      // The fresh rec uses a sentinel analysisVersion that matches nothing
      // the renderer will compute — BUT we flip the auto-stale effect off
      // for this test via the same kill-switch that gates the auto-run,
      // because the Phase 3a assertions here deliberately check the UI's
      // pre-Phase-4 "trust the status the caller set" contract.
      const seedResult = await page.evaluate(async (currentAnalysisVersion) => {
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
        }
        const api = (window as unknown as { producerPlayer?: TestApi }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        const state = await api.getUserState();
        const songId = state.songOrder?.[0];
        if (!songId) throw new Error('no song in songOrder');

        const freshRec = {
          recommendedValue: '-12.5 LUFS',
          recommendedRawValue: -12.5,
          reason: 'Target Spotify ceiling with 1.5 LU headroom.',
          model: 'test-model',
          requestId: 'req-fresh',
          // Must match the live analysisVersion or Phase 4 auto-stale will
          // immediately flip this rec to 'stale' — defeating the point of
          // asserting on the 'fresh' treatment.
          analysisVersion: currentAnalysisVersion,
          generatedAt: Date.now(),
          status: 'fresh' as const,
        };
        const staleRec = {
          recommendedValue: '-1.0 dBTP',
          recommendedRawValue: -1.0,
          reason: 'Historical recommendation; analysis drift detected.',
          model: 'test-model',
          requestId: 'req-stale',
          // Deliberate mismatch so this rec stays 'stale' (also matches the
          // explicit `status: 'stale'` seed below).
          analysisVersion: 'v0-mismatch',
          generatedAt: Date.now() - 60_000,
          status: 'stale' as const,
        };

        await api.setAiRecommendation(songId, 1, 'integrated_lufs', freshRec);
        await api.setAiRecommendation(songId, 1, 'true_peak', staleRec);
        return { songId };
      }, analysisVersionString);
      expect(seedResult.songId).toBeTruthy();

      // --- Open the fullscreen Mastering overlay -------------------------
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('ai-rec-toolbar')).toBeVisible();

      // --- Toggle is visible + default ON --------------------------------
      const toggle = page.getByTestId('ai-rec-toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeChecked();

      // --- Regenerate button is visible + enabled ------------------------
      const regen = page.getByTestId('ai-rec-regenerate');
      await expect(regen).toBeVisible();
      await expect(regen).toBeEnabled();

      // --- With toggle ON, captions are visible (seeded above) -----------
      const freshCaption = page.getByTestId('ai-rec-integrated_lufs');
      const staleCaption = page.getByTestId('ai-rec-true_peak');
      await expect(freshCaption).toBeVisible({ timeout: 5_000 });
      await expect(freshCaption).toContainText('AI recommendation:');
      await expect(freshCaption).toContainText('-12.5 LUFS');
      await expect(freshCaption).toHaveAttribute('data-ai-rec-status', 'fresh');

      await expect(staleCaption).toBeVisible();
      await expect(staleCaption).toHaveAttribute('data-ai-rec-status', 'stale');
      await expect(staleCaption).toContainText('(stale)');
      await expect(staleCaption).toHaveClass(/ai-rec-stale/);
      // Strikethrough applies to the value span only
      const staleValue = staleCaption.locator('.ai-rec-caption-value');
      const textDecoration = await staleValue.evaluate(
        (el) => getComputedStyle(el as HTMLElement).textDecorationLine
      );
      expect(textDecoration).toMatch(/line-through/);

      // --- Toggle OFF → captions disappear -------------------------------
      await toggle.uncheck();
      await expect(toggle).not.toBeChecked();
      await expect(freshCaption).toHaveCount(0);
      await expect(staleCaption).toHaveCount(0);

      // --- Toggle back ON → captions reappear ----------------------------
      await toggle.check();
      await expect(toggle).toBeChecked();
      await expect(freshCaption).toBeVisible();
      await expect(staleCaption).toBeVisible();

      // --- Light-blue text is the palette --accent colour ----------------
      const captionColor = await freshCaption.evaluate(
        (el) => getComputedStyle(el as HTMLElement).color
      );
      // --accent is #5ca7ff which resolves to rgb(92, 167, 255)
      expect(captionColor).toMatch(/rgb\(\s*92,\s*167,\s*255\s*\)/);

      // --- Regenerate button clears the set (Phase 3a stub) --------------
      // Clicking does not throw, clears the seeded recs, and the captions
      // disappear — Phase 4 (v3.33) will replace this with a real agent
      // call that repopulates the set asynchronously.
      await regen.click();
      await expect(freshCaption).toHaveCount(0, { timeout: 5_000 });
      await expect(staleCaption).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
