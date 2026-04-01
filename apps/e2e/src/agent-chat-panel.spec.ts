import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ENABLE_AGENT_FEATURES } from '@producer-player/contracts';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
} from './helpers/electron-app';

type FakeCliEnvironment = {
  binDirectory: string;
  logDirectory: string;
  env: Record<string, string>;
};

function buildFakeCliScript(provider: 'claude' | 'codex'): string {
  const version = provider === 'claude' ? '2.1.81 (Claude Code)' : 'codex-cli 0.104.0';

  return `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const provider = ${JSON.stringify(provider)};
const args = process.argv.slice(2);
const logDir = process.env.PRODUCER_PLAYER_FAKE_AGENT_LOG_DIR;
const streamMode = process.env.PRODUCER_PLAYER_FAKE_AGENT_STREAMING === '1';
const chunkDelayMs = Number(process.env.PRODUCER_PLAYER_FAKE_AGENT_CHUNK_DELAY_MS || '160');
const finalDelayMs = Number(process.env.PRODUCER_PLAYER_FAKE_AGENT_FINAL_DELAY_MS || '0');

function extractCurrentMessage(stdin) {
  const match = stdin.match(/<current-user-message>\\n([\\s\\S]*?)\\n<\\/current-user-message>/);
  return match ? match[1].trim() : stdin.trim();
}

function appendLog(entry) {
  if (!logDir) return;
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, provider + '.jsonl'), JSON.stringify(entry) + '\\n');
}

function emit(event) {
  console.log(JSON.stringify(event));
}

function runAfterFinalDelay(callback) {
  if (finalDelayMs > 0) {
    setTimeout(callback, finalDelayMs);
    return;
  }
  callback();
}

if (args.includes('--version') || args.includes('-V') || args.includes('-v')) {
  console.log(${JSON.stringify(version)});
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  const modelFlag = '--model';
  const modelIndex = args.indexOf(modelFlag);
  const model = modelIndex >= 0 ? args[modelIndex + 1] : 'unknown-model';
  const currentMessage = extractCurrentMessage(stdin);

  appendLog({ provider, argv: args, stdin, currentMessage, model, streamMode });

  if (provider === 'claude') {
    const fullText = 'CLAUDE(' + model + '): ' + currentMessage;

    if (!streamMode) {
      runAfterFinalDelay(() => {
        emit({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: fullText },
          },
        });
        emit({
          type: 'result',
          result: fullText,
          usage: { input_tokens: 21, output_tokens: 8 },
        });
      });
      return;
    }

    const prefix = 'CLAUDE(' + model + '): ';
    const remainder = currentMessage;

    emit({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: prefix },
      },
    });

    setTimeout(() => {
      emit({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: remainder },
        },
      });

      setTimeout(() => {
        emit({
          type: 'result',
          result: fullText,
          usage: { input_tokens: 21, output_tokens: 8 },
        });
      }, chunkDelayMs);
    }, chunkDelayMs);

    return;
  }

  const fullText = 'CODEX(' + model + '): ' + currentMessage;

  emit({ type: 'thread.started', thread_id: 'test-thread' });
  emit({ type: 'turn.started' });

  if (!streamMode) {
    runAfterFinalDelay(() => {
      emit({
        type: 'item.completed',
        item: {
          id: 'item-1',
          type: 'agent_message',
          text: fullText,
        },
      });
      emit({
        type: 'turn.completed',
        usage: { input_tokens: 34, cached_input_tokens: 13, output_tokens: 11 },
      });
    });
    return;
  }

  const chunkSize = Math.max(1, Math.floor(fullText.length / 3));
  const chunks = [
    fullText.slice(0, chunkSize),
    fullText.slice(chunkSize, chunkSize * 2),
    fullText.slice(chunkSize * 2),
  ].filter(Boolean);

  const itemId = 'item-1';
  let index = 0;

  function emitNextChunk() {
    if (index >= chunks.length) {
      emit({
        type: 'item.completed',
        item: {
          id: itemId,
          type: 'agent_message',
          text: fullText,
        },
      });
      emit({
        type: 'turn.completed',
        usage: { input_tokens: 34, cached_input_tokens: 13, output_tokens: 11 },
      });
      return;
    }

    emit({
      type: 'item.delta',
      item: {
        id: itemId,
        type: 'agent_message',
        text: chunks[index],
      },
    });

    index += 1;
    setTimeout(emitNextChunk, chunkDelayMs);
  }

  emitNextChunk();
});
process.stdin.resume();
`;
}

async function createFakeCliEnvironment(rootDirectory: string): Promise<FakeCliEnvironment> {
  const binDirectory = path.join(rootDirectory, 'fake-agent-bin');
  const logDirectory = path.join(rootDirectory, 'fake-agent-logs');

  await fs.mkdir(binDirectory, { recursive: true });
  await fs.mkdir(logDirectory, { recursive: true });

  await fs.writeFile(path.join(binDirectory, 'claude'), buildFakeCliScript('claude'), {
    mode: 0o755,
  });
  await fs.writeFile(path.join(binDirectory, 'codex'), buildFakeCliScript('codex'), {
    mode: 0o755,
  });

  return {
    binDirectory,
    logDirectory,
    env: {
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      PRODUCER_PLAYER_FAKE_AGENT_LOG_DIR: logDirectory,
    },
  };
}

async function readJsonLines(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

test.describe('Agent Chat Panel', () => {
  if (!ENABLE_AGENT_FEATURES) {
    test('toggle is hidden when agent features are disabled', async () => {
      const dirs = await createE2ETestDirectories('agent-panel-disabled');
      const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

      try {
        await expect(page.getByTestId('app-shell')).toBeVisible();
        await expect(page.getByTestId('agent-panel-toggle')).toHaveCount(0);
        await expect(page.getByTestId('agent-chat-panel')).toHaveCount(0);
      } finally {
        await electronApp.close();
        await cleanupE2ETestDirectories(dirs);
      }
    });

    return;
  }

  test('toggle button is visible on launch', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-toggle');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('agent-panel-toggle')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('first-launch onboarding auto-opens once and does not repeat after restart', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-onboarding-first-run');

    let firstRun: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstRun = await launchProducerPlayer(dirs.userDataDirectory);

      const firstPanel = firstRun.page.getByTestId('agent-chat-panel');
      await expect(firstPanel).toBeAttached();
      const firstRunInitiallyOpen = await firstPanel.evaluate((el) =>
        el.classList.contains('agent-chat-panel--open')
      );
      expect(firstRunInitiallyOpen).toBe(false);

      await expect
        .poll(
          async () =>
            firstPanel.evaluate((el) => el.classList.contains('agent-chat-panel--open')),
          { timeout: 12000 }
        )
        .toBe(true);

      const firstLaunchState = await firstRun.page.evaluate(() => ({
        panelSeen: localStorage.getItem('producer-player.agent-panel-seen'),
        onboardingArmed: localStorage.getItem(
          'producer-player.agent-panel-onboarding-armed'
        ),
      }));

      expect(firstLaunchState.panelSeen).toBe('true');
      expect(firstLaunchState.onboardingArmed).toBe('true');

      await firstRun.electronApp.close();
      firstRun = null;

      const secondRun = await launchProducerPlayer(dirs.userDataDirectory);

      try {
        const secondPanel = secondRun.page.getByTestId('agent-chat-panel');
        await expect(secondPanel).toBeAttached();

        await secondRun.page.waitForTimeout(2500);
        const secondRunAutoOpened = await secondPanel.evaluate((el) =>
          el.classList.contains('agent-chat-panel--open')
        );
        expect(secondRunAutoOpened).toBe(false);

        const secondLaunchState = await secondRun.page.evaluate(() => ({
          panelSeen: localStorage.getItem('producer-player.agent-panel-seen'),
          onboardingArmed: localStorage.getItem(
            'producer-player.agent-panel-onboarding-armed'
          ),
        }));

        expect(secondLaunchState.panelSeen).toBe('true');
        expect(secondLaunchState.onboardingArmed).toBe('true');
      } finally {
        await secondRun.electronApp.close();
      }
    } finally {
      if (firstRun) {
        await firstRun.electronApp.close();
      }
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('panel opens and closes when toggle is clicked', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-open-close');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(page.getByTestId('agent-panel-toggle')).toBeVisible();

      const panel = page.getByTestId('agent-chat-panel');
      await expect(panel).toBeAttached();
      const hasOpenClass = await panel.evaluate((el) =>
        el.classList.contains('agent-chat-panel--open')
      );
      expect(hasOpenClass).toBe(false);

      await page.getByTestId('agent-panel-toggle').click();
      await expect(panel).toHaveClass(/agent-chat-panel--open/);
      await expect(page.getByTestId('agent-panel-title')).toHaveText('Producey Boy');
      await expect(page.locator('.agent-panel-subtitle')).toHaveCount(0);
      await expect(page.locator('.agent-experimental-label')).toHaveCount(0);
      await expect(page.getByTestId('agent-help-toggle')).toHaveAttribute('title', 'Assistant setup help');
      await expect(page.getByTestId('agent-history-toggle')).toHaveAttribute('title', 'Chat history');
      await expect(page.getByTestId('agent-settings-toggle')).toHaveAttribute('title', 'Assistant settings');
      await expect(page.getByTestId('agent-panel-close')).toBeVisible();
      await expect(page.getByTestId('agent-panel-close')).toHaveAttribute('title', 'Minimize');

      await page.getByTestId('agent-panel-close').click();
      const hasOpenClassAfterClose = await panel.evaluate((el) =>
        el.classList.contains('agent-chat-panel--open')
      );
      expect(hasOpenClassAfterClose).toBe(false);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('empty state shows starter prompts', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-empty-state');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await expect(page.getByTestId('agent-empty-state')).toBeVisible();
      await expect(page.getByTestId('agent-empty-state-steps')).toContainText('Install Claude Code or Codex CLI.');
      await expect(page.getByTestId('agent-empty-state-help')).toBeVisible();
      await expect(page.getByTestId('agent-provider-notice')).toHaveCount(0);
      await expect(page.getByTestId('agent-starter-chip')).toHaveCount(4);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('settings menu opens and the provider/model picker works', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-settings');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).toBeVisible();

      const modelSelect = page.getByTestId('agent-model-select');
      const thinkingSelect = page.getByTestId('agent-thinking-select');
      const systemPromptInput = page.getByTestId('agent-system-prompt-input');
      await expect(page.getByTestId('agent-provider-claude')).toBeVisible();
      await expect(page.getByTestId('agent-provider-codex')).toBeVisible();
      await expect(modelSelect).toHaveValue('claude-sonnet-4-6');
      await expect(modelSelect.locator('option')).toHaveCount(3);
      await expect(thinkingSelect).toHaveValue('high');
      await expect(systemPromptInput).toBeVisible();
      await expect(systemPromptInput).toHaveValue(/full-access mastering agent/i);
      await expect(page.getByTestId('agent-system-prompt-reset')).toBeVisible();
      await expect(page.getByTestId('agent-deepgram-key-help')).toContainText(
        'microphone button appears beside the message box'
      );
      await expect(page.getByTestId('agent-clear-chat')).toContainText('Start new chat');
      await expect(page.getByTestId('agent-open-chat-history')).toContainText('Chat history');

      await page.getByTestId('agent-provider-codex').click();
      await expect(modelSelect).toHaveValue('gpt-5.4');
      await expect(modelSelect.locator('option')).toHaveCount(6);
      await expect(thinkingSelect).toHaveValue('high');
      await expect(modelSelect.locator('option')).toContainText([
        'GPT-5.4',
        'GPT-5.4 Mini',
        'GPT-5.3 Codex',
      ]);

      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).not.toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('sidebar settings button opens assistant settings', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-branding-settings-button');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await expect(page.getByTestId('producer-player-settings-button')).toBeVisible();
      const panel = page.getByTestId('agent-chat-panel');
      await expect(panel).toBeAttached();
      await expect(page.getByTestId('agent-settings')).toHaveCount(0);

      await page.getByTestId('producer-player-settings-button').click();

      await expect(panel).toHaveClass(/agent-chat-panel--open/);
      await expect(page.getByTestId('agent-settings')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Cmd/Ctrl+, opens assistant settings', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-settings-shortcut');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      const panel = page.getByTestId('agent-chat-panel');
      await expect(panel).toBeAttached();
      await expect(page.getByTestId('agent-settings')).toHaveCount(0);

      const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.down(modifierKey);
      await page.keyboard.press(',');
      await page.keyboard.up(modifierKey);

      await expect(panel).toHaveClass(/agent-chat-panel--open/);
      await expect(page.getByTestId('agent-settings')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('reset settings restores assistant defaults without touching shared user data', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-reset-settings');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    const seededSharedState = {
      ratings: {
        'song-reset-test': 4,
      },
      checklists: {
        'song-reset-test': [
          {
            id: 'check-reset-test',
            text: 'Keep transient detail',
            completed: false,
            timestampSeconds: 12.5,
            versionNumber: 2,
          },
        ],
      },
      projectFilePaths: {
        'song-reset-test': '/tmp/reset-test.logicx',
      },
    };

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();

      await page.evaluate(async (state) => {
        const bridge = (window as unknown as { producerPlayer: { setSharedUserState: (payload: unknown) => Promise<unknown> } }).producerPlayer;
        await bridge.setSharedUserState(state);
      }, seededSharedState);

      const sharedStateBeforeReset = (await page.evaluate(async () => {
        const bridge = (window as unknown as { producerPlayer: { getSharedUserState: () => Promise<unknown> } }).producerPlayer;
        return bridge.getSharedUserState();
      })) as {
        ratings: Record<string, number>;
        checklists: Record<string, unknown>;
        projectFilePaths: Record<string, string>;
      };

      expect(sharedStateBeforeReset.ratings).toEqual(seededSharedState.ratings);
      expect(sharedStateBeforeReset.checklists).toEqual(seededSharedState.checklists);
      expect(sharedStateBeforeReset.projectFilePaths).toEqual(
        seededSharedState.projectFilePaths
      );

      const modelSelect = page.getByTestId('agent-model-select');
      const thinkingSelect = page.getByTestId('agent-thinking-select');
      const systemPromptInput = page.getByTestId('agent-system-prompt-input');

      await page.getByTestId('agent-provider-codex').click();
      await modelSelect.selectOption('gpt-5.3-codex');
      await thinkingSelect.selectOption('low');
      await systemPromptInput.fill('Temporary reset test prompt');

      await page.getByTestId('agent-system-prompt-reset').click();

      await expect(page.getByTestId('agent-provider-claude')).toHaveClass(/--active/);
      await expect(modelSelect).toHaveValue('claude-sonnet-4-6');
      await expect(thinkingSelect).toHaveValue('high');
      await expect(systemPromptInput).toHaveValue(/full-access mastering agent/i);

      const sharedStateAfterReset = (await page.evaluate(async () => {
        const bridge = (window as unknown as { producerPlayer: { getSharedUserState: () => Promise<unknown> } }).producerPlayer;
        return bridge.getSharedUserState();
      })) as {
        ratings: Record<string, number>;
        checklists: Record<string, unknown>;
        projectFilePaths: Record<string, string>;
      };

      expect(sharedStateAfterReset.ratings).toEqual(seededSharedState.ratings);
      expect(sharedStateAfterReset.checklists).toEqual(seededSharedState.checklists);
      expect(sharedStateAfterReset.projectFilePaths).toEqual(
        seededSharedState.projectFilePaths
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('header help dialog explains CLI setup and low-cost model', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-help-dialog');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-help-toggle').click();

      const helpDialog = page.getByTestId('agent-help-dialog');
      await expect(helpDialog).toBeVisible();
      await expect(helpDialog).toContainText('Set up Producey Boy');
      await expect(helpDialog).toContainText('claude auth');
      await expect(helpDialog).toContainText('existing subscription');
      await expect(helpDialog).toContainText('automatic compaction has not been verified');
      await expect(page.getByTestId('agent-help-tutorial-sources')).toContainText(
        'Tutorial source context'
      );
      await expect(page.getByTestId('agent-help-tutorial-sources')).toContainText(
        'Producer Player GitHub repo'
      );
      await expect(page.getByTestId('agent-help-tutorial-sources')).toContainText(
        'Published docs / guide site'
      );

      await page.getByTestId('agent-help-close').dispatchEvent('click');
      await expect(helpDialog).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('composer textarea accepts input', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-composer');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await expect(input).toBeVisible();

      const micButton = page.getByTestId('agent-mic-button');
      await expect(micButton).toBeVisible();
      await expect(micButton).toBeDisabled();

      await input.fill('Hello agent');
      await expect(input).toHaveValue('Hello agent');
      await expect(page.getByTestId('agent-send-button')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('voice button becomes available when a Deepgram key is set, even with the legacy hide flag', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-voice-refresh');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.evaluate(() => {
        localStorage.setItem('producer-player.agent-hide-voice', 'true');
      });

      await page.getByTestId('agent-panel-toggle').click();

      const micButton = page.getByTestId('agent-mic-button');
      await expect(micButton).toBeVisible();
      await expect(micButton).toBeDisabled();

      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-deepgram-key-input').fill('dg_test_key');
      await page.getByTestId('agent-settings-key-save').click();
      await expect(page.getByTestId('agent-deepgram-key-help')).toBeVisible();
      await page.getByTestId('agent-settings-toggle').click();

      await expect(micButton).toBeVisible();
      const voiceSupported = await page.evaluate(() => {
        return (
          typeof navigator.mediaDevices?.getUserMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
        );
      });

      if (voiceSupported) {
        await expect(micButton).toBeEnabled();
      } else {
        await expect(micButton).toBeDisabled();
        await expect(micButton).toHaveAttribute('title', 'Voice input is not supported in this environment');
      }
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('voice button follows the selected STT provider key', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-voice-provider-switch');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const micButton = page.getByTestId('agent-mic-button');
      await expect(micButton).toBeVisible();
      await expect(micButton).toBeDisabled();

      const voiceSupported = await page.evaluate(() => {
        return (
          typeof navigator.mediaDevices?.getUserMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
        );
      });

      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-stt-provider-assemblyai').click();
      await page.getByTestId('agent-assemblyai-key-input').fill('aa_test_key');
      await page.getByTestId('agent-assemblyai-key-save').click();
      await expect(page.getByTestId('agent-assemblyai-key-help')).toBeVisible();
      await page.getByTestId('agent-settings-toggle').click();

      if (voiceSupported) {
        await expect(micButton).toBeEnabled();
        await expect(micButton).toHaveAttribute('title', /AssemblyAI/i);
      } else {
        await expect(micButton).toBeDisabled();
      }

      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-stt-provider-deepgram').click();
      await page.getByTestId('agent-settings-toggle').click();

      await expect(micButton).toBeDisabled();
      if (voiceSupported) {
        await expect(micButton).toHaveAttribute('title', /Deepgram/i);
      }

      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-deepgram-key-input').fill('dg_test_key');
      await page.getByTestId('agent-settings-key-save').click();
      await expect(page.getByTestId('agent-deepgram-key-help')).toBeVisible();
      await page.getByTestId('agent-settings-toggle').click();

      if (voiceSupported) {
        await expect(micButton).toBeEnabled();
        await expect(micButton).toHaveAttribute('title', /Deepgram/i);
      } else {
        await expect(micButton).toBeDisabled();
      }
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Claude end-to-end uses the selected model and preserves conversation history', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-claude-e2e');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      const customSystemPrompt = 'Claude full access mastering test prompt';

      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-model-select').selectOption('claude-haiku-4-5');
      await page.getByTestId('agent-thinking-select').selectOption('medium');
      await page.getByTestId('agent-system-prompt-input').fill(customSystemPrompt);
      await page.getByTestId('agent-settings-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('First test question');
      await page.getByTestId('agent-send-button').click();
      await expect(page.getByTestId('agent-message-agent').last()).toContainText(
        'CLAUDE(claude-haiku-4-5): First test question'
      );

      await input.fill('Follow up question');
      await page.getByTestId('agent-send-button').click();
      await expect(page.getByTestId('agent-message-agent').last()).toContainText(
        'CLAUDE(claude-haiku-4-5): Follow up question'
      );

      const claudeLogs = await readJsonLines(path.join(fakeCli.logDirectory, 'claude.jsonl'));
      expect(claudeLogs).toHaveLength(2);

      const firstArgs = claudeLogs[0]?.argv as string[];
      expect(firstArgs).toContain('--model');
      expect(firstArgs).toContain('--output-format');
      expect(firstArgs).toContain('stream-json');
      expect(firstArgs).toContain('--verbose');
      expect(firstArgs).toContain('--dangerously-skip-permissions');
      expect(firstArgs).toContain('--effort');
      expect(firstArgs).toContain('--system-prompt');
      expect(firstArgs).not.toContain('--tools');
      expect(firstArgs[firstArgs.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
      expect(firstArgs[firstArgs.indexOf('--effort') + 1]).toBe('medium');
      expect(firstArgs[firstArgs.indexOf('--system-prompt') + 1]).toBe(customSystemPrompt);

      const firstPrompt = String(claudeLogs[0]?.stdin ?? '');
      expect(firstPrompt).toContain('<ui-context>');
      expect(firstPrompt).toContain('"domSnapshot"');

      const secondPrompt = String(claudeLogs[1]?.stdin ?? '');
      expect(secondPrompt).toContain('<conversation-history>');
      expect(secondPrompt).toContain('User:\nFirst test question');
      expect(secondPrompt).toContain('Assistant:\nCLAUDE(claude-haiku-4-5): First test question');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Codex end-to-end uses the selected model', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-codex-e2e');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      const customSystemPrompt = 'Codex full access mastering test prompt';

      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-provider-codex').click();
      await page.getByTestId('agent-model-select').selectOption('gpt-5.3-codex');
      await page.getByTestId('agent-thinking-select').selectOption('low');
      await page.getByTestId('agent-system-prompt-input').fill(customSystemPrompt);
      await page.getByTestId('agent-settings-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Need codex help');
      await page.getByTestId('agent-send-button').click();
      await expect(page.getByTestId('agent-message-agent').last()).toContainText(
        'CODEX(gpt-5.3-codex): Need codex help'
      );

      const codexLogs = await readJsonLines(path.join(fakeCli.logDirectory, 'codex.jsonl'));
      expect(codexLogs).toHaveLength(1);
      const codexArgs = codexLogs[0]?.argv as string[];
      expect(codexArgs.slice(0, 2)).toEqual(['exec', '--skip-git-repo-check']);
      expect(codexArgs).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(codexArgs).toContain('-c');
      expect(codexArgs).toContain('model_reasoning_effort="low"');
      expect(codexArgs).toContain('--json');
      expect(codexArgs[codexArgs.indexOf('--model') + 1]).toBe('gpt-5.3-codex');

      const codexPrompt = String(codexLogs[0]?.stdin ?? '');
      expect(codexPrompt).toContain('<agent-system-prompt>');
      expect(codexPrompt).toContain(customSystemPrompt);
      expect(codexPrompt).toContain('<ui-context>');
      expect(codexPrompt).toContain('"domSnapshot"');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Claude streams into the active message before completion', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-claude-streaming');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        ...fakeCli.env,
        PRODUCER_PLAYER_FAKE_AGENT_STREAMING: '1',
        PRODUCER_PLAYER_FAKE_AGENT_CHUNK_DELAY_MS: '320',
      },
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Claude streaming check');
      await page.getByTestId('agent-send-button').click();

      const content = page
        .getByTestId('agent-message-agent')
        .last()
        .locator('.agent-message-content');

      await expect(content.locator('.agent-thinking-label')).toBeVisible();
      await expect(content).toContainText('CLAUDE(claude-sonnet-4-6):', { timeout: 5000 });

      const fullText = 'CLAUDE(claude-sonnet-4-6): Claude streaming check';
      await expect
        .poll(async () => {
          const text = (await content.innerText()).trim();
          return text.length > 0 && text.length < fullText.length;
        })
        .toBe(true);

      await expect(content).toContainText(fullText);
      await expect(content.locator('.agent-thinking-label')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('composer stays editable during streaming and send steers the active turn', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-steer-while-streaming');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        ...fakeCli.env,
        PRODUCER_PLAYER_FAKE_AGENT_STREAMING: '1',
        PRODUCER_PLAYER_FAKE_AGENT_CHUNK_DELAY_MS: '420',
      },
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('First steering turn');
      await page.getByTestId('agent-send-button').click();

      const firstAssistantContent = page
        .getByTestId('agent-message-agent')
        .first()
        .locator('.agent-message-content');

      await expect(firstAssistantContent.locator('.agent-thinking-label')).toBeVisible();
      await expect(firstAssistantContent).toContainText('CLAUDE(claude-sonnet-4-6):', {
        timeout: 5000,
      });

      await expect(input).toBeEnabled();
      await input.fill('Second steering turn');
      await page.getByTestId('agent-send-button').click();

      await expect(page.getByTestId('agent-message-agent').first()).toContainText('(stopped)');
      await expect(page.getByTestId('agent-message-agent').last()).toContainText(
        'CLAUDE(claude-sonnet-4-6): Second steering turn'
      );

      const claudeLogs = await readJsonLines(path.join(fakeCli.logDirectory, 'claude.jsonl'));
      expect(claudeLogs).toHaveLength(2);
      expect(String(claudeLogs[1]?.currentMessage ?? '')).toBe('Second steering turn');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Codex item.delta chunks stream without duplicating the final message', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-codex-streaming');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        ...fakeCli.env,
        PRODUCER_PLAYER_FAKE_AGENT_STREAMING: '1',
        PRODUCER_PLAYER_FAKE_AGENT_CHUNK_DELAY_MS: '320',
      },
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-provider-codex').click();
      await page.getByTestId('agent-model-select').selectOption('gpt-5.3-codex');
      await page.getByTestId('agent-settings-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Codex streaming check');
      await page.getByTestId('agent-send-button').click();

      const content = page
        .getByTestId('agent-message-agent')
        .last()
        .locator('.agent-message-content');

      await expect(content.locator('.agent-thinking-label')).toBeVisible();
      await expect(content).toContainText('CODEX(gpt-5.3-codex):', { timeout: 5000 });

      const fullText = 'CODEX(gpt-5.3-codex): Codex streaming check';
      await expect(content).toContainText(fullText);
      await expect(content.locator('.agent-thinking-label')).toHaveCount(0);

      const finalText = (await content.innerText()).trim();
      expect(finalText).toBe(fullText);
      expect((finalText.match(/CODEX\(gpt-5\.3-codex\):/g) ?? []).length).toBe(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('new chat archives conversation and clears timeline', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-new-chat');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Test message for archive');
      await page.getByTestId('agent-send-button').click();
      await expect(page.getByTestId('agent-message-user').first()).toBeVisible({ timeout: 5000 });

      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).toBeVisible();
      await page.getByTestId('agent-clear-chat').click();

      const timeline = page.getByTestId('agent-timeline');
      await expect(timeline.getByTestId('agent-message-user')).toHaveCount(0, { timeout: 3000 });

      await page.getByTestId('agent-history-toggle').click();
      await expect(page.getByTestId('agent-history-state')).toBeVisible();
      await expect(page.getByTestId('agent-history-item')).toHaveCount(1);
      await page.getByTestId('agent-history-open').first().click();
      await expect(page.getByTestId('agent-history-state')).toHaveCount(0);
      await expect(page.getByTestId('agent-message-user').first()).toContainText('Test message for archive');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('settings and active chat persist after restart', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-persist-restart');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);

    let firstRun: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstRun = await launchProducerPlayer(dirs.userDataDirectory, {
        extraEnv: fakeCli.env,
      });

      await firstRun.page.getByTestId('agent-panel-toggle').click();
      await firstRun.page.getByTestId('agent-settings-toggle').click();
      await firstRun.page.getByTestId('agent-provider-codex').click();
      await firstRun.page.getByTestId('agent-model-select').selectOption('gpt-5.3-codex');
      await firstRun.page.getByTestId('agent-thinking-select').selectOption('low');
      await firstRun.page.getByTestId('agent-settings-toggle').click();

      const firstInput = firstRun.page.getByTestId('agent-composer-input');
      await firstInput.fill('Persist this chat');
      await firstRun.page.getByTestId('agent-send-button').click();
      await expect(firstRun.page.getByTestId('agent-message-agent').last()).toContainText(
        'CODEX(gpt-5.3-codex): Persist this chat'
      );

      await firstRun.electronApp.close();
      firstRun = null;

      const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
        extraEnv: fakeCli.env,
      });

      try {
        await page.getByTestId('agent-panel-toggle').click();
        await expect(page.getByTestId('agent-message-user').first()).toContainText(
          'Persist this chat'
        );

        await page.getByTestId('agent-settings-toggle').click();
        await expect(page.getByTestId('agent-provider-codex')).toHaveClass(/--active/);
        await expect(page.getByTestId('agent-model-select')).toHaveValue('gpt-5.3-codex');
        await expect(page.getByTestId('agent-thinking-select')).toHaveValue('low');
        await page.getByTestId('agent-settings-toggle').click();

        const input = page.getByTestId('agent-composer-input');
        await input.fill('Second turn after restart');
        await page.getByTestId('agent-send-button').click();

        await expect(page.getByTestId('agent-message-agent').last()).toContainText(
          'CODEX(gpt-5.3-codex): Second turn after restart'
        );

        const codexLogs = await readJsonLines(path.join(fakeCli.logDirectory, 'codex.jsonl'));
        expect(codexLogs).toHaveLength(2);

        const secondPrompt = String(codexLogs[1]?.stdin ?? '');
        expect(secondPrompt).toContain('<conversation-history>');
        expect(secondPrompt).toContain('User:\nPersist this chat');
      } finally {
        await electronApp.close();
      }
    } finally {
      if (firstRun) {
        await firstRun.electronApp.close();
      }
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Enter key sends message and Shift+Enter adds newline', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-keyboard');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.focus();
      await input.fill('Line one');
      await input.press('Shift+Enter');
      await input.evaluate((el) => {
        (el as HTMLTextAreaElement).value += 'Line two';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const value = await input.inputValue();
      expect(value).toContain('Line one');
      await input.press('Enter');

      await expect(page.getByTestId('agent-message-user').first()).toBeVisible({ timeout: 5000 });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
