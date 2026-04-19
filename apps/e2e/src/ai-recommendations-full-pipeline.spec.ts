import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

/**
 * v3.33 — Phase 4 of the AI recommendations chain.
 *
 * Wires the agent invocation itself + auto-run on track open. Because the
 * real agent call hits the LLM CLI, these scenarios use the Phase 4 E2E mock
 * hook (`window.__producerPlayerAiRecMock`) installed by the app's test path
 * — the renderer short-circuits before dispatching to the agent and routes a
 * canned response through the same persistence pipeline.
 *
 * Scenarios:
 *   - Auto-run fires once on track open and populates the panel captions.
 *   - Regenerate clears recs and repopulates them via the mock.
 *   - Show AI recommendations toggle OFF → captions hidden, data preserved.
 *   - agentAutoRecommendEnabled OFF → auto-run does NOT fire on track open.
 *   - Chat-tool match: typing "rerun mastering recommendations" fires refresh.
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

async function installAiRecMock(page: import('@playwright/test').Page): Promise<void> {
  // The mock returns a deterministic canned response so specs can assert on
  // specific metric values. Invocation count is tracked on window so tests
  // can assert "auto-run fired exactly N times".
  await page.evaluate(() => {
    const win = window as unknown as {
      __producerPlayerAiRecMock?: (input: unknown) => unknown;
      __producerPlayerAiRecMockCallCount?: number;
      __producerPlayerAiRecMockCalls?: Array<{ source: string; songId: string; versionNumber: number }>;
    };
    win.__producerPlayerAiRecMockCallCount = 0;
    win.__producerPlayerAiRecMockCalls = [];
    win.__producerPlayerAiRecMock = (inputUnknown: unknown) => {
      const input = inputUnknown as {
        source: 'auto' | 'manual' | 'tool';
        songId: string;
        versionNumber: number;
      };
      win.__producerPlayerAiRecMockCallCount =
        (win.__producerPlayerAiRecMockCallCount ?? 0) + 1;
      win.__producerPlayerAiRecMockCalls!.push({
        source: input.source,
        songId: input.songId,
        versionNumber: input.versionNumber,
      });
      return {
        integrated_lufs: {
          recommendedValue: '-14.0 LUFS',
          recommendedRawValue: -14.0,
          reason: 'Streaming target.',
        },
        true_peak: {
          recommendedValue: '-1.0 dBTP',
          recommendedRawValue: -1.0,
          reason: 'Headroom for transcoding.',
        },
        crest_factor: {
          recommendedValue: '10.0 dB',
          recommendedRawValue: 10,
          reason: 'Dynamic range.',
        },
      };
    };
  });
}

async function getMockCallCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __producerPlayerAiRecMockCallCount?: number })
        .__producerPlayerAiRecMockCallCount ?? 0,
  );
}

async function setAgentAutoRecommendEnabled(
  page: import('@playwright/test').Page,
  enabled: boolean,
): Promise<void> {
  // Flip React state directly via the test hook. Using setUserState alone
  // doesn't work because main's SET_USER_STATE handler does NOT broadcast
  // USER_STATE_CHANGED back, so the renderer's React state stays stale and
  // the debounced writer would re-publish the default value on its next tick.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as {
        __producerPlayerSetAutoRecommend?: (enabled: boolean) => void;
      }).__producerPlayerSetAutoRecommend === 'function',
    null,
    { timeout: 10_000 },
  );
  await page.evaluate((flag) => {
    const setter = (window as unknown as {
      __producerPlayerSetAutoRecommend?: (enabled: boolean) => void;
    }).__producerPlayerSetAutoRecommend;
    if (!setter) throw new Error('__producerPlayerSetAutoRecommend missing');
    setter(flag);
  }, enabled);

  // Let the debounced sync flush so the persisted value matches React state.
  await page.waitForTimeout(700);
}

test.describe('AI recommendations full pipeline (Phase 4) @smoke', () => {
  test('auto-run populates captions and Regenerate re-fires the mock', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-ai-recommendations-full',
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'AI Rec Pipeline v1.wav'),
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory,
    );

    try {
      // Install the mock BEFORE linking the folder so the very first auto-run
      // sees it. Also ensure default agent provider/model stays resolvable.
      await installAiRecMock(page);

      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      // Open fullscreen mastering overlay to satisfy the toggle-ON gate AND
      // so the ai-rec captions render inside the overlay.
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      // Auto-run should fire within a few seconds once analysis completes.
      await expect
        .poll(async () => getMockCallCount(page), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(1);

      // Captions paint after the mock's persisted recs are fetched.
      const integratedCaption = page.getByTestId('ai-rec-integrated_lufs');
      await expect(integratedCaption).toBeVisible({ timeout: 10_000 });
      await expect(integratedCaption).toContainText('-14.0 LUFS');

      const peakCaption = page.getByTestId('ai-rec-true_peak');
      await expect(peakCaption).toBeVisible();
      await expect(peakCaption).toContainText('-1.0 dBTP');

      // Regenerate clears captions and the mock fires again (count increments).
      const regen = page.getByTestId('ai-rec-regenerate');
      await expect(regen).toBeEnabled();
      const countBeforeRegen = await getMockCallCount(page);
      await regen.click();

      await expect
        .poll(async () => getMockCallCount(page), { timeout: 10_000 })
        .toBeGreaterThan(countBeforeRegen);

      // Captions repopulate with the fresh mock response.
      await expect(integratedCaption).toBeVisible({ timeout: 10_000 });
      await expect(integratedCaption).toContainText('-14.0 LUFS');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('toggling Show AI recommendations OFF hides captions without touching data', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-ai-recommendations-toggle',
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'AI Rec Toggle v1.wav'),
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory,
    );

    try {
      await installAiRecMock(page);

      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();
      await page.getByTestId('analysis-expand-button').click();

      await expect
        .poll(async () => getMockCallCount(page), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(1);

      const caption = page.getByTestId('ai-rec-integrated_lufs');
      await expect(caption).toBeVisible({ timeout: 10_000 });

      const toggle = page.getByTestId('ai-rec-toggle');
      await toggle.uncheck();
      await expect(caption).toHaveCount(0);

      // Data is preserved — flipping back ON brings the caption back.
      await toggle.check();
      await expect(caption).toBeVisible();
      await expect(caption).toContainText('-14.0 LUFS');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('agentAutoRecommendEnabled OFF: auto-run does NOT fire on track open, manual Regenerate still works', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-ai-recommendations-disabled',
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'AI Rec Disabled v1.wav'),
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory,
    );

    try {
      await installAiRecMock(page);

      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      // Flip the auto-run gate OFF AFTER the app has finished its initial
      // hydration (folder-link round-trip guarantees that). Then give the
      // debounced writer another moment to settle so the "default ON" value
      // doesn't clobber our explicit OFF on its next sync cycle.
      await setAgentAutoRecommendEnabled(page, false);
      await page.waitForTimeout(700);

      // v3.38 Windows-flake fix (Codex round 2): on slow CI the
      // AgentChatPanel's header is still physically covering the main
      // list row, so Playwright sees "<agent-panel-header> intercepts
      // pointer events" and times out. `force: true` only skips the
      // actionability check — the click can still land on the panel
      // header. Correct fix: minimize the panel if it's open, then click.
      const agentClose = page.getByTestId('agent-panel-close');
      if (await agentClose.count() > 0 && await agentClose.isVisible()) {
        await agentClose.click({ timeout: 5_000 }).catch(() => undefined);
      }
      await page.getByTestId('main-list-row').first().click();
      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      // Give the app time to settle analysis — if the gate were ON, the
      // mock would have fired by now. With the gate OFF, call count stays 0.
      await page.waitForTimeout(4_000);
      const autoRunCalls = await getMockCallCount(page);
      expect(autoRunCalls).toBe(0);

      // Manual Regenerate still fires the mock.
      await page.getByTestId('ai-rec-regenerate').click();
      await expect
        .poll(async () => getMockCallCount(page), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(1);

      const caption = page.getByTestId('ai-rec-integrated_lufs');
      await expect(caption).toBeVisible({ timeout: 10_000 });
      await expect(caption).toContainText('-14.0 LUFS');

      // Confirm the last-source tag was 'manual', not 'auto'.
      const lastSource = await page.evaluate(
        () => {
          const win = window as unknown as {
            __producerPlayerAiRecMockCalls?: Array<{ source: string }>;
          };
          const calls = win.__producerPlayerAiRecMockCalls ?? [];
          return calls[calls.length - 1]?.source ?? null;
        },
      );
      expect(lastSource).toBe('manual');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('chat-tool pattern: typing "rerun mastering recommendations" fires the regenerate flow', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-ai-recommendations-tool',
    );

    await writeTestWav(
      path.join(directories.fixtureDirectory, 'AI Rec Tool v1.wav'),
    );

    const { electronApp, page } = await launchProducerPlayer(
      directories.userDataDirectory,
    );

    try {
      await installAiRecMock(page);

      await page.evaluate(async (folderPath) => {
        const api = (window as unknown as {
          producerPlayer?: { linkFolder: (path: string) => Promise<void> };
        }).producerPlayer;
        if (!api) throw new Error('producerPlayer API unavailable');
        await api.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();
      await page.getByTestId('analysis-expand-button').click();

      await expect
        .poll(async () => getMockCallCount(page), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(1);

      // v3.36 (Codex round 2): wait for a rendered AI caption with the
      // mock's canned value, not just the mock call count. The mock call
      // happens BEFORE `setAiRecommendation` lands + React flushes — if we
      // fire the detector on the mock-count signal alone, the subsequent
      // `clearAiRecommendations()` can race the in-flight auto-run's state
      // update and the second mock call is either dropped by the monotonic
      // run-id guard or timed-out by the poll. Asserting on the rendered
      // text (`-14.0 LUFS` from the mock) proves the full
      // mock → parse → setAiRecommendation → fetchback → render chain
      // completed so the detector always fires from a steady state.
      await expect(page.getByTestId('ai-rec-integrated_lufs')).toContainText(
        '-14.0 LUFS',
        { timeout: 20_000 },
      );

      const callsBefore = await getMockCallCount(page);

      // Invoke the detector directly via the window harness hook. The UX
      // flow would have the user type this into the composer; the detector
      // is the same code path whether triggered from the composer or a test.
      const handled = await page.evaluate(() => {
        const detector = (window as unknown as {
          __producerPlayerAiRecTool?: (message: string) => boolean;
        }).__producerPlayerAiRecTool;
        if (!detector) return false;
        return detector('rerun mastering recommendations');
      });
      expect(handled).toBe(true);

      // v3.35: bumped from 10s to 20s to match the auto-run poll timeout —
      // CI ubuntu runners regularly need >10s for the clear → retrigger
      // → mock-invocation chain under load.
      await expect
        .poll(async () => getMockCallCount(page), { timeout: 20_000 })
        .toBeGreaterThan(callsBefore);

      const lastSource = await page.evaluate(() => {
        const win = window as unknown as {
          __producerPlayerAiRecMockCalls?: Array<{ source: string }>;
        };
        const calls = win.__producerPlayerAiRecMockCalls ?? [];
        return calls[calls.length - 1]?.source ?? null;
      });
      expect(lastSource).toBe('tool');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
