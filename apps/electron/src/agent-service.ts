import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  DEFAULT_AGENT_MODEL_BY_PROVIDER,
  type AgentContext,
  type AgentEvent,
  type AgentMode,
  type AgentModelId,
  type AgentProviderId,
  type AgentTokenUsage,
  type AgentUiContext,
} from '@producer-player/contracts';

const MASTERING_SYSTEM_PROMPT = `You are Producer Player's full-access mastering agent.

Core role:
- You are an expert mastering engineer for modern recorded music.
- Give direct, technically grounded advice about loudness, dynamics, tonal balance, stereo image, clipping, translation, and platform readiness.
- Respect artistic intent, but be blunt about technical problems.

Environment + permissions:
- Treat this session as full-permission by default.
- You may inspect the local Producer Player source tree and related project files when the underlying CLI supports it.
- A live UI context payload may be provided on each turn, including the current app URL, document title, and a DOM snapshot of the current window.
- You may propose and write JavaScript that would inspect or mutate app state arbitrarily when that helps accomplish the task.
- If a requested DOM or state mutation is not directly executable through the current host wiring, say that plainly and provide the exact JavaScript or source-code change you would apply.

Behavior:
- Use the supplied analysis context and UI context before guessing.
- When discussing UI or implementation issues, reason from the DOM snapshot and the available source code.
- Prefer concrete fixes, patches, selectors, state updates, and parameter ranges over vague advice.
- Unless the user is clearly asking for product/debugging work, stay grounded in mastering and Producer Player tasks.`;

type AgentHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

interface AgentTurnState {
  assistantText: string;
  finalized: boolean;
  sawAssistantText: boolean;
}

interface AgentSessionState {
  provider: AgentProviderId;
  mode: AgentMode;
  model: AgentModelId;
  process: ChildProcess | null;
  systemPrompt: string;
  alive: boolean;
  history: AgentHistoryEntry[];
  activeTurn: AgentTurnState | null;
}

let currentSession: AgentSessionState | null = null;
let eventCallback: ((event: AgentEvent) => void) | null = null;

function emitEvent(event: AgentEvent): void {
  if (eventCallback) {
    eventCallback(event);
  }
}

function resolveCliPath(command: string): string | null {
  try {
    const result = execFileSync('/usr/bin/which', [command], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    const commonPaths = [
      `/usr/local/bin/${command}`,
      `/opt/homebrew/bin/${command}`,
      `${process.env.HOME}/.local/bin/${command}`,
      `${process.env.HOME}/.npm-global/bin/${command}`,
    ];
    for (const candidate of commonPaths) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}

function getCommandName(provider: AgentProviderId): 'claude' | 'codex' {
  return provider === 'claude' ? 'claude' : 'codex';
}

function getCliNotFoundMessage(provider: AgentProviderId): string {
  if (provider === 'claude') {
    return 'Claude Code CLI not found. Install it with `npm i -g @anthropic-ai/claude-code` and run `claude auth`.';
  }
  return 'Codex CLI not found. Install it from the Codex project and ensure `codex` is available on your PATH.';
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeModel(provider: AgentProviderId, model?: AgentModelId): AgentModelId {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
}

function buildConversationHistory(history: AgentSessionState['history']): string {
  return history
    .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}:\n${entry.content}`)
    .join('\n\n');
}

function buildTurnPrompt(
  session: AgentSessionState,
  message: string,
  context?: AgentContext | null,
  uiContext?: AgentUiContext | null,
): string {
  const sections: string[] = [
    'Continue this in-app Producer Player conversation. Keep your response grounded in the supplied analysis context, UI context, and available source code when present.',
  ];

  if (session.provider === 'codex') {
    sections.push(`<agent-system-prompt>\n${session.systemPrompt}\n</agent-system-prompt>`);
  }

  if (context) {
    sections.push(`<analysis-context>\n${JSON.stringify(context, null, 2)}\n</analysis-context>`);
  }

  if (uiContext) {
    sections.push(`<ui-context>\n${JSON.stringify(uiContext, null, 2)}\n</ui-context>`);
  }

  if (session.history.length > 0) {
    sections.push(
      `<conversation-history>\n${buildConversationHistory(session.history)}\n</conversation-history>`
    );
  }

  sections.push(`<current-user-message>\n${message}\n</current-user-message>`);
  sections.push('Respond directly to the current user message.');

  return sections.join('\n\n');
}

function getSpawnArgs(session: AgentSessionState): string[] {
  if (session.provider === 'claude') {
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      session.model,
      '--system-prompt',
      session.systemPrompt,
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ];
  }

  return [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--dangerously-bypass-approvals-and-sandbox',
    '--model',
    session.model,
    '--json',
    '-',
  ];
}

function appendAssistantText(session: AgentSessionState, content: string): void {
  const turn = session.activeTurn;
  if (!turn || content.length === 0) return;
  turn.assistantText += content;
  turn.sawAssistantText = true;
  emitEvent({ type: 'text-delta', content });
}

function finalizeTurn(session: AgentSessionState, usage?: AgentTokenUsage): void {
  const turn = session.activeTurn;
  if (!turn || turn.finalized) {
    return;
  }

  turn.finalized = true;
  if (turn.assistantText.trim().length > 0) {
    session.history.push({ role: 'assistant', content: turn.assistantText });
  }
  session.activeTurn = null;
  session.process = null;
  emitEvent(usage ? { type: 'turn-complete', usage } : { type: 'turn-complete' });
}

function toUsage(input: Record<string, unknown>): AgentTokenUsage | undefined {
  const inputTokens = typeof input.input_tokens === 'number' ? input.input_tokens : undefined;
  const outputTokens = typeof input.output_tokens === 'number' ? input.output_tokens : undefined;
  const cacheReadTokens =
    typeof input.cached_input_tokens === 'number'
      ? input.cached_input_tokens
      : typeof input.cache_read_input_tokens === 'number'
        ? input.cache_read_input_tokens
        : undefined;

  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

function handleClaudeJsonLine(session: AgentSessionState, parsed: Record<string, unknown>): void {
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  if (type === 'stream_event' && isJsonRecord(parsed.event)) {
    handleClaudeJsonLine(session, parsed.event);
    return;
  }

  if (type === 'content_block_delta') {
    const delta = isJsonRecord(parsed.delta) ? parsed.delta : null;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      appendAssistantText(session, delta.text);
    }
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      emitEvent({ type: 'thinking', content: delta.thinking });
    }
    return;
  }

  if (type === 'assistant' && !session.activeTurn?.sawAssistantText) {
    const message = isJsonRecord(parsed.message) ? parsed.message : null;
    const contentBlocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of contentBlocks) {
      if (isJsonRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        appendAssistantText(session, block.text);
      }
    }
    return;
  }

  if (type === 'result') {
    if (typeof parsed.result === 'string' && !session.activeTurn?.sawAssistantText) {
      appendAssistantText(session, parsed.result);
    }
    const usage = isJsonRecord(parsed.usage) ? toUsage(parsed.usage) : undefined;
    finalizeTurn(session, usage);
    return;
  }

  if (type === 'error') {
    const error = isJsonRecord(parsed.error) ? parsed.error : null;
    emitEvent({
      type: 'error',
      code: typeof error?.type === 'string' ? error.type : 'AGENT_ERROR',
      message:
        typeof error?.message === 'string' ? error.message : 'Unknown Claude Code error.',
    });
  }
}

function handleCodexJsonLine(session: AgentSessionState, parsed: Record<string, unknown>): void {
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  if (type === 'item.completed') {
    const item = isJsonRecord(parsed.item) ? parsed.item : null;
    if (
      item &&
      (item.type === 'agent_message' || item.type === 'message') &&
      typeof item.text === 'string'
    ) {
      appendAssistantText(session, item.text);
    }
    return;
  }

  if (type === 'item.delta') {
    const item = isJsonRecord(parsed.item) ? parsed.item : null;
    if (item && typeof item.text === 'string') {
      appendAssistantText(session, item.text);
    }
    return;
  }

  if (type === 'turn.completed') {
    const usage = toUsage(parsed.usage && isJsonRecord(parsed.usage) ? parsed.usage : {});
    finalizeTurn(session, usage);
    return;
  }

  if (type.includes('error')) {
    const message = typeof parsed.message === 'string' ? parsed.message : 'Unknown Codex error.';
    emitEvent({
      type: 'error',
      code: 'CODEX_ERROR',
      message,
    });
  }
}

export function isProviderAvailable(provider: AgentProviderId): boolean {
  return resolveCliPath(getCommandName(provider)) !== null;
}

export function startSession(
  provider: AgentProviderId,
  mode: AgentMode,
  systemPrompt?: string,
  model?: AgentModelId,
): void {
  if (currentSession?.alive) {
    destroySession();
  }

  const cliPath = resolveCliPath(getCommandName(provider));
  if (!cliPath) {
    emitEvent({
      type: 'error',
      code: 'CLI_NOT_FOUND',
      message: getCliNotFoundMessage(provider),
    });
    return;
  }

  currentSession = {
    provider,
    mode,
    model: normalizeModel(provider, model),
    process: null,
    systemPrompt: systemPrompt || MASTERING_SYSTEM_PROMPT,
    alive: true,
    history: [],
    activeTurn: null,
  };
}

export function sendTurn(
  message: string,
  context?: AgentContext | null,
  uiContext?: AgentUiContext | null,
): void {
  if (!currentSession?.alive) {
    emitEvent({
      type: 'error',
      code: 'NO_SESSION',
      message: 'No active agent session. Start a session first.',
    });
    return;
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return;
  }

  const session = currentSession;

  if (session.process) {
    try {
      session.process.kill('SIGTERM');
    } catch {
      // ignore
    }
    session.process = null;
  }

  const cliPath = resolveCliPath(getCommandName(session.provider));
  if (!cliPath) {
    emitEvent({
      type: 'error',
      code: 'CLI_NOT_FOUND',
      message: getCliNotFoundMessage(session.provider),
    });
    return;
  }

  const prompt = buildTurnPrompt(session, trimmedMessage, context, uiContext);
  const child = spawn(cliPath, getSpawnArgs(session), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: 'true',
    },
    cwd: process.cwd(),
  });

  session.history.push({ role: 'user', content: trimmedMessage });
  session.process = child;
  session.activeTurn = {
    assistantText: '',
    finalized: false,
    sawAssistantText: false,
  };

  child.stdin?.end(prompt);

  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    if (!session.alive) return;

    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    try {
      const parsed = JSON.parse(trimmed);
      if (!isJsonRecord(parsed)) {
        appendAssistantText(session, trimmed);
        return;
      }

      if (session.provider === 'claude') {
        handleClaudeJsonLine(session, parsed);
      } else {
        handleCodexJsonLine(session, parsed);
      }
    } catch {
      appendAssistantText(session, trimmed);
    }
  });

  let stderrOutput = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  child.on('error', (err) => {
    if (!session.alive) return;
    emitEvent({
      type: 'error',
      code: 'PROCESS_ERROR',
      message: `Agent process error: ${err.message}`,
    });
  });

  child.on('exit', (code, signal) => {
    if (!session.alive) return;

    const trimmedStderr = stderrOutput.trim();
    if (code !== 0 && code !== null) {
      emitEvent({
        type: 'error',
        code: 'PROCESS_EXIT',
        message:
          trimmedStderr.length > 0
            ? trimmedStderr
            : `Agent process exited with code ${code}${signal ? ` (${signal})` : ''}`,
      });
    }

    finalizeTurn(session);
  });
}

export function interrupt(): void {
  if (currentSession?.process) {
    try {
      currentSession.process.kill('SIGTERM');
    } catch {
      // ignore
    }
    finalizeTurn(currentSession);
  }
}

export function respondToApproval(
  _approvalId: string,
  _decision: 'allow' | 'deny',
): void {
  // Tool-use approval is not exposed in this desktop implementation yet.
}

export function destroySession(): void {
  if (currentSession) {
    currentSession.alive = false;
    if (currentSession.process) {
      try {
        currentSession.process.kill('SIGTERM');
      } catch {
        // ignore
      }
      currentSession.process = null;
    }
    currentSession.activeTurn = null;
    currentSession = null;
    emitEvent({ type: 'session-ended', reason: 'User ended session' });
  }
}

export function setEventCallback(callback: ((event: AgentEvent) => void) | null): void {
  eventCallback = callback;
}
