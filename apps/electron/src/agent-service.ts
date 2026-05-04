import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  DEFAULT_AGENT_MODEL_BY_PROVIDER,
  DEFAULT_AGENT_THINKING_BY_PROVIDER,
  type AgentAttachment,
  type AgentContext,
  type AgentConversationHistoryEntry,
  type AgentEvent,
  type AgentMode,
  type AgentModelId,
  type AgentProviderId,
  type AgentThinkingEffort,
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

Public tutorial context (source-first):
- Use Producer Player's public repo/docs as a tutorial source when users ask "how do I use X?" or ask for walkthroughs.
- Source anchors:
  - https://github.com/EthanSK/producer-player
  - https://github.com/EthanSK/producer-player/blob/main/README.md
  - https://ethansk.github.io/producer-player/
- Combine those public docs with the live UI context and local source tree before answering.
- Prefer step-by-step, in-app tutorials with concrete controls, labels, and expected outcomes.

Behavior:
- Use the supplied analysis context and UI context before guessing.
- If analysis-context.masteringCache is present and you rely on it, explicitly say that you are using cached mastering data and name the track(s).
- When discussing UI or implementation issues, reason from the DOM snapshot and the available source code.
- Prefer concrete fixes, patches, selectors, state updates, and parameter ranges over vague advice.
- Unless the user is clearly asking for product/debugging work, stay grounded in mastering and Producer Player tasks.

Cross-track / album / version comparisons:
- analysis-context.masteringCache.tracks contains EVERY VERSION of EVERY SONG in the current album — one entry per version (songId, songTitle, versionId, fileName, filePath, cacheStatus, analyzedAt, staticAnalysis, platformNormalization, isActiveVersion). Group entries by songId to reason about "song X" as a whole, and within a group compare versionId/fileName ordering to reason about V5-vs-V7-style version drift. \`isActiveVersion: true\` marks the version that is currently selected in the UI for that song.
- Use those values directly for "compare to the other songs", "compare V5 to V7 of song X", "how does this fit the album?", "is my loudness consistent across versions?", and similar questions. You can answer ANY question that depends on enumerating songs OR versions from this array alone — no UI clicks needed.
- DO NOT use Read, Bash, or any file-system tool to open the audio files at masteringCache.tracks[*].filePath. You cannot decode audio from the CLI, the numbers you would extract that way are already in staticAnalysis, and reading those file paths can trigger macOS permission prompts (network/removable/iCloud volumes) that interrupt the user.
- If a track's cacheStatus is "missing", "stale", "pending", or "error" instead of "fresh", say so and ask the user to open that song/version in the app so it gets analyzed — do not try to analyze it yourself.
- File-system tools (Read/Bash/etc.) are still fair game for the Producer Player source tree when the user asks app/debugging questions; just keep them off the user's audio files.`;

type AgentHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

interface AgentTurnState {
  assistantText: string;
  finalized: boolean;
  sawAssistantText: boolean;
  codexItemTextById: Map<string, string>;
}

interface AgentSessionState {
  provider: AgentProviderId;
  mode: AgentMode;
  model: AgentModelId;
  thinking: AgentThinkingEffort;
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
  // On Windows, use `where.exe`; on macOS/Linux, use `/usr/bin/which`.
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where.exe' : '/usr/bin/which';

  try {
    const result = execFileSync(whichCommand, [command], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    // `where.exe` may return multiple lines; take the first match.
    const firstLine = result.split(/\r?\n/)[0]?.trim();
    return firstLine || null;
  } catch {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const commonPaths: string[] = isWindows
      ? [
          `${process.env.APPDATA}\\npm\\${command}.cmd`,
          `${process.env.APPDATA}\\npm\\${command}`,
          `${homeDir}\\.local\\bin\\${command}.cmd`,
          `${homeDir}\\.local\\bin\\${command}`,
        ]
      : [
          `/usr/local/bin/${command}`,
          `/opt/homebrew/bin/${command}`,
          `${homeDir}/.local/bin/${command}`,
          `${homeDir}/.npm-global/bin/${command}`,
        ];

    for (const candidate of commonPaths) {
      if (candidate && existsSync(candidate)) {
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

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isIgnoredInputStreamError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

function normalizeModel(provider: AgentProviderId, model?: AgentModelId): AgentModelId {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
}

function normalizeThinking(
  provider: AgentProviderId,
  thinking?: AgentThinkingEffort,
): AgentThinkingEffort {
  if (thinking === 'low' || thinking === 'medium' || thinking === 'high') {
    return thinking;
  }
  return DEFAULT_AGENT_THINKING_BY_PROVIDER[provider];
}

function normalizeSeedHistory(
  history?: AgentConversationHistoryEntry[],
): AgentHistoryEntry[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .flatMap((entry) => {
      const role = entry?.role;
      const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
      if ((role !== 'user' && role !== 'assistant') || content.length === 0) {
        return [];
      }
      return [{ role, content } as const];
    })
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
}

function buildConversationHistory(history: AgentSessionState['history']): string {
  return history
    .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}:\n${entry.content}`)
    .join('\n\n');
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildAttachmentsSection(attachments: AgentAttachment[]): string {
  const lines = attachments.map((attachment) => {
    const mime = attachment.mimeType ? ` · ${attachment.mimeType}` : '';
    return `- ${attachment.name} (${formatAttachmentSize(attachment.sizeBytes)}${mime})\n  path: ${attachment.path}`;
  });

  return [
    '<attached-files>',
    'The user attached the following files to this turn. The absolute path is on the local filesystem; read it with your file-read tool if it would help answer the question. Do NOT decode audio files — describe what you can from metadata or the producer-player analysis context instead.',
    '',
    ...lines,
    '</attached-files>',
  ].join('\n');
}

function buildTurnPrompt(
  session: AgentSessionState,
  message: string,
  context?: AgentContext | null,
  uiContext?: AgentUiContext | null,
  attachments?: AgentAttachment[],
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

  if (Array.isArray(attachments) && attachments.length > 0) {
    sections.push(buildAttachmentsSection(attachments));
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
      '--effort',
      session.thinking,
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
    '-c',
    `model_reasoning_effort="${session.thinking}"`,
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

function readCodexText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => readCodexText(entry)).join('');
  }

  if (!isJsonRecord(value)) {
    return '';
  }

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.delta === 'string') {
    return value.delta;
  }

  if (isJsonRecord(value.delta)) {
    const nestedDeltaText = readCodexText(value.delta);
    if (nestedDeltaText.length > 0) {
      return nestedDeltaText;
    }
  }

  if (Array.isArray(value.content)) {
    const contentText = readCodexText(value.content);
    if (contentText.length > 0) {
      return contentText;
    }
  }

  if (Array.isArray(value.parts)) {
    const partsText = readCodexText(value.parts);
    if (partsText.length > 0) {
      return partsText;
    }
  }

  return '';
}

function normalizeCodexMessageText(value: unknown): string | null {
  const text = readCodexText(value);
  return text.length > 0 ? text : null;
}

function appendCodexDeltaText(
  session: AgentSessionState,
  itemId: string | null,
  deltaText: string,
): void {
  if (!itemId) {
    appendAssistantText(session, deltaText);
    return;
  }

  const activeTurn = session.activeTurn;
  const previousText = activeTurn?.codexItemTextById.get(itemId) ?? '';

  if (deltaText.startsWith(previousText)) {
    const nextChunk = deltaText.slice(previousText.length);
    if (nextChunk.length > 0) {
      appendAssistantText(session, nextChunk);
    }
    activeTurn?.codexItemTextById.set(itemId, deltaText);
    return;
  }

  appendAssistantText(session, deltaText);
  activeTurn?.codexItemTextById.set(itemId, previousText + deltaText);
}

function appendCodexCompletedText(
  session: AgentSessionState,
  itemId: string | null,
  completedText: string,
): void {
  if (!itemId) {
    appendAssistantText(session, completedText);
    return;
  }

  const activeTurn = session.activeTurn;
  const previousText = activeTurn?.codexItemTextById.get(itemId) ?? '';

  if (completedText === previousText) {
    return;
  }

  if (previousText.length > 0 && completedText.startsWith(previousText)) {
    const remainder = completedText.slice(previousText.length);
    if (remainder.length > 0) {
      appendAssistantText(session, remainder);
    }
    activeTurn?.codexItemTextById.set(itemId, completedText);
    return;
  }

  const assistantText = activeTurn?.assistantText ?? '';
  if (!assistantText.endsWith(completedText)) {
    appendAssistantText(session, completedText);
  }
  activeTurn?.codexItemTextById.set(itemId, completedText);
}

function handleCodexJsonLine(session: AgentSessionState, parsed: Record<string, unknown>): void {
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  if (type === 'response.output_text.delta') {
    const deltaText = normalizeCodexMessageText(parsed.delta);
    if (deltaText) {
      appendAssistantText(session, deltaText);
    }
    return;
  }

  if (type === 'item.delta') {
    const item = isJsonRecord(parsed.item) ? parsed.item : null;
    const itemId = typeof item?.id === 'string' ? item.id : null;
    const deltaText =
      normalizeCodexMessageText(parsed.delta) ?? normalizeCodexMessageText(item);

    if (deltaText) {
      appendCodexDeltaText(session, itemId, deltaText);
    }
    return;
  }

  if (type === 'item.completed') {
    const item = isJsonRecord(parsed.item) ? parsed.item : null;
    if (
      item &&
      (item.type === 'agent_message' || item.type === 'message' || item.type === 'output_text')
    ) {
      const itemId = typeof item.id === 'string' ? item.id : null;
      const completedText = normalizeCodexMessageText(item);
      if (completedText) {
        appendCodexCompletedText(session, itemId, completedText);
      }
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
  thinking?: AgentThinkingEffort,
  history?: AgentConversationHistoryEntry[],
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
    thinking: normalizeThinking(provider, thinking),
    process: null,
    systemPrompt: systemPrompt || MASTERING_SYSTEM_PROMPT,
    alive: true,
    history: normalizeSeedHistory(history),
    activeTurn: null,
  };
}

export function sendTurn(
  message: string,
  context?: AgentContext | null,
  uiContext?: AgentUiContext | null,
  attachments?: AgentAttachment[],
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
    const previousProcess = session.process;
    session.process = null;

    try {
      previousProcess.kill('SIGTERM');
    } catch {
      // ignore
    }

    // Escalate to SIGKILL if the previous process doesn't exit promptly.
    const killTimeout = setTimeout(() => {
      try {
        previousProcess.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, 2000);

    previousProcess.on('exit', () => clearTimeout(killTimeout));
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

  const prompt = buildTurnPrompt(
    session,
    trimmedMessage,
    context,
    uiContext,
    attachments,
  );
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
    codexItemTextById: new Map<string, string>(),
  };

  const stdin = child.stdin;
  if (stdin) {
    stdin.on('error', (error: Error) => {
      if (!session.alive || session.process !== child) {
        return;
      }

      if (isIgnoredInputStreamError(error)) {
        return;
      }

      emitEvent({
        type: 'error',
        code: 'PROCESS_STDIN_ERROR',
        message: `Agent input stream error: ${error.message}`,
      });
    });

    try {
      stdin.end(prompt);
    } catch (error: unknown) {
      if (!session.alive || session.process !== child || isIgnoredInputStreamError(error)) {
        return;
      }

      emitEvent({
        type: 'error',
        code: 'PROCESS_STDIN_ERROR',
        message: `Agent input stream error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    if (!session.alive || session.process !== child) return;

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
    if (!session.alive || session.process !== child) {
      return;
    }
    stderrOutput += chunk.toString();
  });

  child.on('error', (err) => {
    if (!session.alive || session.process !== child) return;
    if (isIgnoredInputStreamError(err)) {
      return;
    }
    emitEvent({
      type: 'error',
      code: 'PROCESS_ERROR',
      message: `Agent process error: ${err.message}`,
    });
  });

  child.on('exit', (code, signal) => {
    if (!session.alive || session.process !== child) return;

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
    const runningProcess = currentSession.process;
    currentSession.process = null;

    try {
      runningProcess.kill('SIGTERM');
    } catch {
      // ignore
    }

    // Escalate to SIGKILL if the agent CLI doesn't exit within 2 seconds.
    const killTimeout = setTimeout(() => {
      try {
        runningProcess.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, 2000);

    runningProcess.on('exit', () => clearTimeout(killTimeout));

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
      const proc = currentSession.process;
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }

      // Escalate to SIGKILL if the agent CLI doesn't exit within 2 seconds.
      const killTimeout = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already exited
        }
      }, 2000);

      proc.on('exit', () => clearTimeout(killTimeout));

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
