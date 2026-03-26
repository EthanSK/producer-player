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

function extractCurrentMessage(stdin) {
  const match = stdin.match(/<current-user-message>\\n([\\s\\S]*?)\\n<\\/current-user-message>/);
  return match ? match[1].trim() : stdin.trim();
}

function appendLog(entry) {
  if (!logDir) return;
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, provider + '.jsonl'), JSON.stringify(entry) + '\\n');
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
  const modelFlag = provider === 'claude' ? '--model' : '--model';
  const modelIndex = args.indexOf(modelFlag);
  const model = modelIndex >= 0 ? args[modelIndex + 1] : 'unknown-model';
  const currentMessage = extractCurrentMessage(stdin);

  appendLog({ provider, argv: args, stdin, currentMessage, model });

  if (provider === 'claude') {
    console.log(JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'CLAUDE(' + model + '): ' + currentMessage },
      },
    }));
    console.log(JSON.stringify({
      type: 'result',
      result: 'CLAUDE(' + model + '): ' + currentMessage,
      usage: { input_tokens: 21, output_tokens: 8 },
    }));
    return;
  }

  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item-1',
      type: 'agent_message',
      text: 'CODEX(' + model + '): ' + currentMessage,
    },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 34, cached_input_tokens: 13, output_tokens: 11 },
  }));
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
      await expect(page.getByTestId('agent-panel-title')).toHaveText('Produceboi agent');
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
      const systemPromptInput = page.getByTestId('agent-system-prompt-input');
      await expect(page.getByTestId('agent-provider-claude')).toBeVisible();
      await expect(page.getByTestId('agent-provider-codex')).toBeVisible();
      await expect(modelSelect).toHaveValue('claude-sonnet-4-6');
      await expect(modelSelect.locator('option')).toHaveCount(3);
      await expect(systemPromptInput).toBeVisible();
      await expect(systemPromptInput).toHaveValue(/full-access mastering agent/i);
      await expect(page.getByTestId('agent-system-prompt-reset')).toBeVisible();
      await expect(page.getByTestId('agent-deepgram-key-help')).toContainText(
        'microphone button appears beside the message box'
      );

      await page.getByTestId('agent-provider-codex').click();
      await expect(modelSelect).toHaveValue('gpt-5.4');
      await expect(modelSelect.locator('option')).toHaveCount(6);
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
      expect(firstArgs).toContain('--system-prompt');
      expect(firstArgs).not.toContain('--tools');
      expect(firstArgs[firstArgs.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
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

  test('clear chat removes messages', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-clear');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Test message for clear');
      await page.getByTestId('agent-send-button').click();
      await expect(page.getByTestId('agent-message-user').first()).toBeVisible({ timeout: 5000 });

      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).toBeVisible();

      const clearButton = page.getByTestId('agent-clear-chat');
      await clearButton.click();
      await clearButton.click();

      const timeline = page.getByTestId('agent-timeline');
      await expect(timeline.getByTestId('agent-message-user')).toHaveCount(0, { timeout: 3000 });
    } finally {
      await electronApp.close();
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
