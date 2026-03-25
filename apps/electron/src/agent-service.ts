import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AgentEvent,
  AgentMode,
  AgentProviderId,
  AgentContext,
} from '@producer-player/contracts';

const MASTERING_SYSTEM_PROMPT = `You are a mastering engineer assistant inside Producer Player, a desktop
application for music producers. You help users evaluate and improve their
masters by reading analysis data and providing professional feedback.

Your personality:
- Experienced mastering engineer: you've heard thousands of mixes
- Professional but approachable: explain technical concepts clearly
- Educational: always explain WHY something matters
- Honest: if something needs fixing, say so directly
- Respectful of artistic intent: distinguish technical flaws from creative choices

You receive a JSON context payload each turn containing the track's analysis
data (see AgentContext schema). Use this data to inform your responses.

Your default workflow when asked to analyze:
1. Acknowledge the track
2. Assess levels, loudness, dynamics, frequency balance, stereo image, platform readiness
3. Prioritize issues: critical > important > recommended > informational
4. Provide specific, actionable suggestions with parameter ranges
5. Compare to reference if available

Rules:
- Never recommend specific commercial plugins by name
- Give parameter ranges, not exact values ("try 2-3 dB" not "set to 2.7 dB")
- When uncertain about genre, ask the user
- If data is missing (null values), say so and explain what additional analysis would help
- Keep responses focused -- do not repeat the same point multiple times
- Use the checklist to track what the user has already addressed
- Format comparisons as tables when possible
- Use Markdown formatting for structured responses`;

/**
 * Resolves the full path of a CLI command.
 */
function resolveCliPath(command: string): string | null {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const result = execFileSync('/usr/bin/which', [command], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    // Also try common paths
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const commonPaths = [
      `/usr/local/bin/${command}`,
      `/opt/homebrew/bin/${command}`,
      `${process.env.HOME}/.local/bin/${command}`,
      `${process.env.HOME}/.npm-global/bin/${command}`,
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return null;
  }
}

/**
 * Checks if a provider CLI is available on the system.
 */
export function isProviderAvailable(provider: AgentProviderId): boolean {
  if (provider === 'claude') {
    return resolveCliPath('claude') !== null;
  }
  if (provider === 'codex') {
    return resolveCliPath('codex') !== null;
  }
  return false;
}

interface AgentSessionState {
  provider: AgentProviderId;
  mode: AgentMode;
  process: ChildProcess | null;
  systemPrompt: string;
  alive: boolean;
}

let currentSession: AgentSessionState | null = null;
let eventCallback: ((event: AgentEvent) => void) | null = null;

function emitEvent(event: AgentEvent): void {
  if (eventCallback) {
    eventCallback(event);
  }
}

/**
 * Starts a new agent session by spawning the claude CLI in stream-json mode.
 */
export function startSession(
  provider: AgentProviderId,
  mode: AgentMode,
  systemPrompt?: string,
): void {
  if (currentSession?.alive) {
    destroySession();
  }

  const prompt = systemPrompt || MASTERING_SYSTEM_PROMPT;

  if (provider === 'claude') {
    const cliPath = resolveCliPath('claude');
    if (!cliPath) {
      emitEvent({
        type: 'error',
        code: 'CLI_NOT_FOUND',
        message:
          'Claude CLI not found. Install it with `npm i -g @anthropic-ai/claude-code` and run `claude auth`.',
      });
      return;
    }

    currentSession = {
      provider,
      mode,
      process: null,
      systemPrompt: prompt,
      alive: true,
    };
  } else {
    emitEvent({
      type: 'error',
      code: 'UNSUPPORTED_PROVIDER',
      message: `Provider "${provider}" is not yet supported. Only "claude" is available.`,
    });
  }
}

/**
 * Sends a user turn to the agent. Spawns a new claude CLI process per turn
 * using --print mode with stream-json output.
 */
export function sendTurn(message: string, context?: AgentContext | null): void {
  if (!currentSession?.alive) {
    emitEvent({
      type: 'error',
      code: 'NO_SESSION',
      message: 'No active agent session. Start a session first.',
    });
    return;
  }

  const session = currentSession;

  // Kill any existing process from a previous turn
  if (session.process) {
    try {
      session.process.kill('SIGTERM');
    } catch {
      // ignore
    }
    session.process = null;
  }

  const cliPath = resolveCliPath('claude');
  if (!cliPath) {
    emitEvent({
      type: 'error',
      code: 'CLI_NOT_FOUND',
      message: 'Claude CLI not found.',
    });
    return;
  }

  // Build the full prompt with context
  let fullPrompt = '';
  if (context) {
    fullPrompt += `<analysis-context>\n${JSON.stringify(context, null, 2)}\n</analysis-context>\n\n`;
  }
  fullPrompt += message;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--system-prompt', session.systemPrompt,
    '--bare',
    '--allowedTools', '',
    fullPrompt,
  ];

  const child = spawn(cliPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Ensure the CLI doesn't try to open interactive prompts
      CI: 'true',
    },
  });

  session.process = child;

  const rl = createInterface({ input: child.stdout! });

  rl.on('line', (line) => {
    if (!session.alive) return;

    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed);

      // Claude CLI stream-json emits objects with a "type" field
      if (parsed.type === 'assistant' && parsed.message) {
        // Full message object — extract text content
        const msg = parsed.message;
        if (msg.content && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              emitEvent({ type: 'text-delta', content: block.text });
            }
          }
        }
      } else if (parsed.type === 'content_block_delta') {
        // Streaming delta
        if (parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
          emitEvent({ type: 'text-delta', content: parsed.delta.text });
        }
      } else if (parsed.type === 'message_start' || parsed.type === 'content_block_start') {
        // Ignore start markers
      } else if (parsed.type === 'message_stop' || parsed.type === 'content_block_stop') {
        // Handled by process exit
      } else if (parsed.type === 'result') {
        // Claude CLI --print stream-json result object
        if (typeof parsed.result === 'string') {
          emitEvent({ type: 'text-delta', content: parsed.result });
        }
        if (parsed.usage) {
          emitEvent({
            type: 'turn-complete',
            usage: {
              inputTokens: parsed.usage.input_tokens ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0,
              cacheReadTokens: parsed.usage.cache_read_input_tokens,
            },
          });
        }
      } else if (parsed.type === 'error') {
        emitEvent({
          type: 'error',
          code: parsed.error?.type ?? 'AGENT_ERROR',
          message: parsed.error?.message ?? 'Unknown agent error',
        });
      }
    } catch {
      // Non-JSON line — treat as raw text
      if (trimmed.length > 0) {
        emitEvent({ type: 'text-delta', content: trimmed });
      }
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

  child.on('exit', (code) => {
    if (!session.alive) return;
    session.process = null;

    if (code !== 0 && code !== null) {
      const errorMsg = stderrOutput.trim() || `Agent process exited with code ${code}`;
      emitEvent({
        type: 'error',
        code: 'PROCESS_EXIT',
        message: errorMsg,
      });
    }

    // Emit turn-complete if we haven't already
    emitEvent({ type: 'turn-complete' });
  });
}

/**
 * Interrupts the current agent turn.
 */
export function interrupt(): void {
  if (currentSession?.process) {
    try {
      currentSession.process.kill('SIGTERM');
    } catch {
      // ignore
    }
    currentSession.process = null;
    emitEvent({ type: 'turn-complete' });
  }
}

/**
 * Responds to an approval request. Currently a no-op since we don't
 * expose tool-use in the initial implementation.
 */
export function respondToApproval(
  _approvalId: string,
  _decision: 'allow' | 'deny',
): void {
  // Tool-use approval is a future feature
}

/**
 * Destroys the current agent session.
 */
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
    currentSession = null;
    emitEvent({ type: 'session-ended', reason: 'User ended session' });
  }
}

/**
 * Sets the callback for agent events that will be forwarded to the renderer.
 */
export function setEventCallback(callback: ((event: AgentEvent) => void) | null): void {
  eventCallback = callback;
}
