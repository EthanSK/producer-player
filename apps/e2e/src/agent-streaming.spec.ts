import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
} from './helpers/electron-app';

type FakeCliEnvironment = {
  binDirectory: string;
  env: Record<string, string>;
};

function buildFakeCliScript(provider: 'claude' | 'codex'): string {
  const version = provider === 'claude' ? '2.1.81 (Claude Code)' : 'codex-cli 0.104.0';

  return `#!/usr/bin/env node
const provider = ${JSON.stringify(provider)};
const args = process.argv.slice(2);
const chunkDelayMs = 240;

function emit(event) {
  console.log(JSON.stringify(event));
}

function extractCurrentMessage(stdin) {
  const match = stdin.match(/<current-user-message>\\n([\\s\\S]*?)\\n<\\/current-user-message>/);
  return match ? match[1].trim() : stdin.trim();
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
  const modelIndex = args.indexOf('--model');
  const model = modelIndex >= 0 ? args[modelIndex + 1] : 'unknown-model';
  const currentMessage = extractCurrentMessage(stdin);

  if (provider === 'claude') {
    const prefix = 'CLAUDE(' + model + '): ';
    const remainder = currentMessage;
    const fullText = prefix + remainder;

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
  const chunkSize = Math.max(1, Math.floor(fullText.length / 3));
  const chunks = [
    fullText.slice(0, chunkSize),
    fullText.slice(chunkSize, chunkSize * 2),
    fullText.slice(chunkSize * 2),
  ].filter(Boolean);

  emit({ type: 'thread.started', thread_id: 'streaming-test-thread' });
  emit({ type: 'turn.started' });

  const itemId = 'item-stream-1';
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
  const binDirectory = path.join(rootDirectory, 'fake-streaming-agent-bin');

  await fs.mkdir(binDirectory, { recursive: true });

  await fs.writeFile(path.join(binDirectory, 'claude'), buildFakeCliScript('claude'), {
    mode: 0o755,
  });
  await fs.writeFile(path.join(binDirectory, 'codex'), buildFakeCliScript('codex'), {
    mode: 0o755,
  });

  return {
    binDirectory,
    env: {
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
    },
  };
}

test.describe('Agent streaming behavior', () => {
  test('Claude chunk deltas render before turn completion', async () => {
    const dirs = await createE2ETestDirectories('agent-streaming-claude');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('stream-check-claude');
      await page.getByTestId('agent-send-button').click();

      const content = page
        .getByTestId('agent-message-agent')
        .last()
        .locator('.agent-message-content');

      await expect(content.locator('.agent-thinking-label')).toBeVisible();
      await expect(content).toContainText('CLAUDE(', { timeout: 5000 });
      await expect
        .poll(async () => {
          const text = (await content.innerText()).trim();
          return /^CLAUDE\([^)]+\):$/.test(text);
        })
        .toBe(true);

      await expect(content).toContainText('stream-check-claude');
      const finalText = (await content.innerText()).trim();
      expect(finalText).toMatch(/^CLAUDE\([^)]+\): stream-check-claude$/);
      await expect(content.locator('.agent-thinking-label')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Codex item.delta chunks append once and do not duplicate on item.completed', async () => {
    const dirs = await createE2ETestDirectories('agent-streaming-codex');
    const fakeCli = await createFakeCliEnvironment(dirs.userDataDirectory);
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: fakeCli.env,
    });

    try {
      await page.getByTestId('agent-panel-toggle').click();
      await page.getByTestId('agent-settings-toggle').click();
      await page.getByTestId('agent-provider-codex').click();
      await page.getByTestId('agent-settings-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('stream-check-codex');
      await page.getByTestId('agent-send-button').click();

      const content = page
        .getByTestId('agent-message-agent')
        .last()
        .locator('.agent-message-content');

      await expect(content).toContainText('CODEX(', { timeout: 5000 });
      await expect(content).toContainText('stream-check-codex');

      const finalText = (await content.innerText()).trim();
      expect(finalText).toMatch(/^CODEX\([^)]+\): stream-check-codex$/);
      expect((finalText.match(/CODEX\([^)]+\):/g) ?? []).length).toBe(1);
      await expect(content.locator('.agent-thinking-label')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
