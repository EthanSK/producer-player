// v3.200 — Structured action log (JSONL, rotating).
//
// Producer Player already pipes free-form text logs through `electron-log`,
// which is great for human reading but useless for machines: there's no
// stable schema, levels are bolted onto a single string, and the writer
// happily mixes renderer/main/sidecar context. The action log fixes that
// by writing a separate stream — `actions.jsonl` in the same log directory
// — where every line is a single JSON object describing one user
// interaction or one error. The schema is defined in
// `@producer-player/contracts` (`ActionLogEntry`).
//
// Rotation is hand-rolled because electron-log's rotation does not work
// for non-electron-log streams. The rule is intentionally simple:
//   * After each successful write we sample the file size.
//   * If it exceeds MAX_BYTES (~100 MB by default), we rotate:
//       actions.jsonl     → actions.jsonl.1
//       actions.jsonl.1   → actions.jsonl.2
//       ... up to MAX_ROTATIONS (last file is dropped).
//   * Rotation is best-effort; failures are surfaced via the electron-log
//     channel so they're visible in the normal log without crashing the
//     action-log writer.
//
// All public functions are dependency-injectable through the testing
// surface (`__testing__`) so the hermetic Node test bundle can exercise
// the serializer and rotation logic without touching Electron or
// touching the real filesystem.

import { promises as fs, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  ActionLogEntry,
  ActionLogErrorPayload,
  ActionLogLevel,
  ActionLogSource,
} from '@producer-player/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ~100 MB; keep aligned with `actionLog.test.cjs`. */
export const ACTION_LOG_MAX_BYTES = 100 * 1024 * 1024;

/** Last N rotated files we retain. `actions.jsonl{,.1,.2,.3,.4}` = 5. */
export const ACTION_LOG_MAX_ROTATIONS = 4;

/** Filename of the active stream inside the log directory. */
export const ACTION_LOG_FILE_NAME = 'actions.jsonl';

/** Truncation caps to keep individual entries reasonable. */
const MAX_MESSAGE_CHARS = 2000;
const MAX_STACK_CHARS = 4000;
const MAX_EVENT_CHARS = 120;

const VALID_LEVELS = new Set<ActionLogLevel>(['info', 'warn', 'error']);
const VALID_SOURCES = new Set<ActionLogSource>(['renderer', 'main', 'sidecar']);

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — exported for tests)
// ---------------------------------------------------------------------------

/** Truncate a string with an explicit ellipsis so consumers can detect it. */
export function truncate(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max}ch]`;
}

/**
 * Normalize an `Error`-shaped input into the ActionLogErrorPayload schema.
 * Accepts a real Error, a plain object with `message`, or any value that
 * can be `String()`-ified.
 */
export function normalizeError(input: unknown): ActionLogErrorPayload {
  if (input instanceof Error) {
    return {
      name: input.name || 'Error',
      message: truncate(input.message || '', MAX_MESSAGE_CHARS),
      stack: input.stack ? truncate(input.stack, MAX_STACK_CHARS) : undefined,
    };
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : 'Error';
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : truncate(safeStringify(obj), MAX_MESSAGE_CHARS);
    const stack = typeof obj.stack === 'string' ? truncate(obj.stack, MAX_STACK_CHARS) : undefined;
    return { name, message, stack };
  }
  return {
    name: 'Error',
    message: truncate(input == null ? 'unknown' : String(input), MAX_MESSAGE_CHARS),
  };
}

/**
 * JSON.stringify wrapper that won't throw on circular refs. Used as a
 * last-resort fallback when an object doesn't serialize cleanly.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      if (typeof val === 'bigint') return `${val.toString()}n`;
      if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
      return val;
    });
  }
}

/**
 * Coerce an unknown input into a valid `ActionLogEntry`. Invalid fields
 * fall back to safe defaults — the writer never throws on bad input
 * from the renderer because that would cascade into the action that
 * tried to log itself failing.
 */
export function normalizeEntry(input: unknown, fallbackSource: ActionLogSource = 'main'): ActionLogEntry {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const ts = typeof obj.ts === 'string' && obj.ts ? obj.ts : new Date().toISOString();
  const level = VALID_LEVELS.has(obj.level as ActionLogLevel)
    ? (obj.level as ActionLogLevel)
    : 'info';
  const source = VALID_SOURCES.has(obj.source as ActionLogSource)
    ? (obj.source as ActionLogSource)
    : fallbackSource;
  const event =
    typeof obj.event === 'string' && obj.event.trim()
      ? truncate(obj.event.trim(), MAX_EVENT_CHARS)
      : 'unknown.event';

  const context =
    obj.context && typeof obj.context === 'object' && !Array.isArray(obj.context)
      ? (obj.context as Record<string, unknown>)
      : undefined;

  const error = obj.error ? normalizeError(obj.error) : undefined;

  const entry: ActionLogEntry = { ts, level, event, source };
  if (context) entry.context = context;
  if (error) entry.error = error;
  return entry;
}

/** Serialize one entry to a JSONL line (newline-terminated). */
export function serializeEntry(entry: ActionLogEntry): string {
  return `${safeStringify(entry)}\n`;
}

// ---------------------------------------------------------------------------
// File-system layer (dependency-injectable)
// ---------------------------------------------------------------------------

export interface ActionLogFsHandlers {
  appendFile(path: string, data: string): Promise<void>;
  statSize(path: string): number | null;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): boolean;
}

const realFsHandlers: ActionLogFsHandlers = {
  async appendFile(path, data) {
    await fs.appendFile(path, data, 'utf8');
  },
  statSize(path) {
    try {
      return statSync(path).size;
    } catch {
      return null;
    }
  },
  async rename(from, to) {
    await fs.rename(from, to);
  },
  async unlink(path) {
    await fs.unlink(path);
  },
  async mkdir(path) {
    await fs.mkdir(path, { recursive: true });
  },
  exists(path) {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * Walk the rotation chain from the highest-numbered file backwards:
 *   actions.jsonl.3 → actions.jsonl.4  (drops old .4)
 *   actions.jsonl.2 → actions.jsonl.3
 *   actions.jsonl.1 → actions.jsonl.2
 *   actions.jsonl   → actions.jsonl.1
 *
 * Each step is a rename of an existing file (or a skip if the source
 * isn't there). The final-position file (actions.jsonl.{maxRotations})
 * is unlinked if it exists.
 */
export async function rotateChain(
  baseFilePath: string,
  maxRotations: number,
  fsHandlers: ActionLogFsHandlers
): Promise<void> {
  const oldestPath = `${baseFilePath}.${maxRotations}`;
  if (fsHandlers.exists(oldestPath)) {
    try {
      await fsHandlers.unlink(oldestPath);
    } catch {
      // best-effort
    }
  }
  for (let i = maxRotations - 1; i >= 1; i -= 1) {
    const from = `${baseFilePath}.${i}`;
    const to = `${baseFilePath}.${i + 1}`;
    if (fsHandlers.exists(from)) {
      try {
        await fsHandlers.rename(from, to);
      } catch {
        // best-effort
      }
    }
  }
  if (fsHandlers.exists(baseFilePath)) {
    try {
      await fsHandlers.rename(baseFilePath, `${baseFilePath}.1`);
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Writer (stateful — instance per app session)
// ---------------------------------------------------------------------------

export interface ActionLogWriterOptions {
  /** Directory holding `actions.jsonl`. */
  directory: string;
  /** Byte threshold for rotation. Defaults to ACTION_LOG_MAX_BYTES. */
  maxBytes?: number;
  /** Max numbered rotations to keep (1..N). Defaults to ACTION_LOG_MAX_ROTATIONS. */
  maxRotations?: number;
  /** Optional override for unit tests. */
  fsHandlers?: ActionLogFsHandlers;
  /** Optional callback invoked on write errors (e.g. forward to electron-log). */
  onError?: (error: unknown) => void;
}

export class ActionLogWriter {
  readonly filePath: string;
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly maxRotations: number;
  private readonly handlers: ActionLogFsHandlers;
  private readonly onError: (error: unknown) => void;
  /** Serializes async writes so concurrent appends + rotations don't interleave. */
  private writeChain: Promise<void> = Promise.resolve();
  private directoryReady = false;

  constructor(opts: ActionLogWriterOptions) {
    this.directory = opts.directory;
    this.filePath = join(opts.directory, ACTION_LOG_FILE_NAME);
    this.maxBytes = opts.maxBytes ?? ACTION_LOG_MAX_BYTES;
    this.maxRotations = opts.maxRotations ?? ACTION_LOG_MAX_ROTATIONS;
    this.handlers = opts.fsHandlers ?? realFsHandlers;
    this.onError = opts.onError ?? (() => {});
  }

  /**
   * Append one entry. Returns a promise that resolves once the entry has
   * been flushed (or skipped on error). Callers SHOULD await but the
   * renderer-side bridge fires-and-forgets — that's fine, the writer
   * keeps its own internal queue.
   */
  append(entry: ActionLogEntry): Promise<void> {
    const line = serializeEntry(entry);
    const task = this.writeChain.then(async () => {
      try {
        if (!this.directoryReady) {
          await this.handlers.mkdir(this.directory);
          this.directoryReady = true;
        }
        await this.handlers.appendFile(this.filePath, line);
        const size = this.handlers.statSize(this.filePath);
        if (size !== null && size >= this.maxBytes) {
          await rotateChain(this.filePath, this.maxRotations, this.handlers);
        }
      } catch (error) {
        this.onError(error);
      }
    });
    // The chain promise never rejects (onError swallows) but be defensive.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Wait for all queued writes to drain. Useful for tests + shutdown. */
  flush(): Promise<void> {
    return this.writeChain;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (real runtime)
// ---------------------------------------------------------------------------

let writerSingleton: ActionLogWriter | null = null;

export function initActionLog(opts: ActionLogWriterOptions): ActionLogWriter {
  writerSingleton = new ActionLogWriter(opts);
  return writerSingleton;
}

export function getActionLogWriter(): ActionLogWriter | null {
  return writerSingleton;
}

/** Convenience for main-process callers (no IPC round-trip). */
export function logActionMain(
  event: string,
  context?: Record<string, unknown>,
  level: ActionLogLevel = 'info'
): void {
  const writer = writerSingleton;
  if (!writer) return;
  void writer.append({
    ts: new Date().toISOString(),
    level,
    event,
    source: 'main',
    context,
  });
}

export function logErrorMain(
  event: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const writer = writerSingleton;
  if (!writer) return;
  void writer.append({
    ts: new Date().toISOString(),
    level: 'error',
    event,
    source: 'main',
    context,
    error: normalizeError(error),
  });
}

export function logFromSidecarStderr(line: string): void {
  const writer = writerSingleton;
  if (!writer) return;
  const trimmed = line.trim();
  if (!trimmed) return;
  // Try to parse JSON-shaped sidecar output (pp-audio-host emits some);
  // fall back to free-form `message` context.
  let parsed: Record<string, unknown> | null = null;
  if (trimmed.startsWith('{')) {
    try {
      const candidate = JSON.parse(trimmed);
      if (candidate && typeof candidate === 'object') parsed = candidate as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const level: ActionLogLevel =
    parsed && VALID_LEVELS.has(parsed.level as ActionLogLevel)
      ? (parsed.level as ActionLogLevel)
      : /error|fatal|panic/i.test(trimmed)
        ? 'error'
        : 'info';
  const event =
    parsed && typeof parsed.event === 'string' ? parsed.event : 'sidecar.stderr';
  void writer.append({
    ts: new Date().toISOString(),
    level,
    event,
    source: 'sidecar',
    context: parsed ?? { message: truncate(trimmed, MAX_MESSAGE_CHARS) },
  });
}

// ---------------------------------------------------------------------------
// Test surface — exposed for the hermetic CJS bundle used by node:test.
// ---------------------------------------------------------------------------

export const __testing__ = {
  truncate,
  safeStringify,
  normalizeError,
  normalizeEntry,
  serializeEntry,
  rotateChain,
  ActionLogWriter,
  ACTION_LOG_MAX_BYTES,
  ACTION_LOG_MAX_ROTATIONS,
  ACTION_LOG_FILE_NAME,
};
