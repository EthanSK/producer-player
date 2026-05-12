// v3.200 — Renderer-side structured action log.
//
// Thin wrapper around the `producerPlayer.appendActionLog` IPC bridge.
// All renderer code that wants to log a user action calls one of the
// exported helpers; this module handles:
//
//   * Stamping `ts` + `source: 'renderer'` automatically so call sites
//     don't repeat themselves.
//   * Coercing thrown errors into a serializable shape.
//   * Swallowing failures — the action log is observability, never a
//     blocker for user interaction. A broken IPC bridge (e.g. running
//     under Vitest with no `window.producerPlayer`) silently no-ops
//     rather than throwing.
//
// The wire format is defined in `@producer-player/contracts`
// (`ActionLogEntry`). Main-process rotation + serialization lives in
// `apps/electron/src/actionLog.ts`.

import type {
  ActionLogEntry,
  ActionLogErrorPayload,
  ActionLogLevel,
} from '@producer-player/contracts';

// ---------------------------------------------------------------------------
// Bridge access — tolerant of test environments.
// ---------------------------------------------------------------------------

type BridgeLike = {
  appendActionLog?: (entry: ActionLogEntry) => Promise<void>;
};

function getBridge(): BridgeLike | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { producerPlayer?: BridgeLike }).producerPlayer;
  return candidate ?? null;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

const MAX_MESSAGE_CHARS = 2000;
const MAX_STACK_CHARS = 4000;

function truncate(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max}ch]`;
}

export function toErrorPayload(input: unknown): ActionLogErrorPayload {
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
        ? truncate(obj.message, MAX_MESSAGE_CHARS)
        : truncate(safeStringify(obj), MAX_MESSAGE_CHARS);
    const stack = typeof obj.stack === 'string' ? truncate(obj.stack, MAX_STACK_CHARS) : undefined;
    return { name, message, stack };
  }
  return {
    name: 'Error',
    message: truncate(input == null ? 'unknown' : String(input), MAX_MESSAGE_CHARS),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      return val;
    }) ?? '"[Unserializable]"';
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export function logAction(
  event: string,
  context?: Record<string, unknown>,
  level: ActionLogLevel = 'info'
): void {
  const bridge = getBridge();
  if (!bridge?.appendActionLog) return;
  const entry: ActionLogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    source: 'renderer',
  };
  if (context && Object.keys(context).length > 0) entry.context = context;
  // Fire and forget — never await in handler hot paths.
  try {
    void bridge.appendActionLog(entry).catch(() => undefined);
  } catch {
    // ipc surface temporarily broken; drop silently.
  }
}

export function logError(
  event: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const bridge = getBridge();
  if (!bridge?.appendActionLog) return;
  const entry: ActionLogEntry = {
    ts: new Date().toISOString(),
    level: 'error',
    event,
    source: 'renderer',
    error: toErrorPayload(error),
  };
  if (context && Object.keys(context).length > 0) entry.context = context;
  try {
    void bridge.appendActionLog(entry).catch(() => undefined);
  } catch {
    // ignore
  }
}

/**
 * Install global `error` / `unhandledrejection` handlers that funnel
 * uncaught renderer errors into the action log. Safe to call multiple
 * times — the returned cleanup detaches the listeners we added.
 *
 * Returns a no-op cleanup if `window` is unavailable (e.g. Vitest jsdom
 * environments may or may not have it). Callers are expected to invoke
 * this in a `useEffect` once at App-mount time.
 */
export function installRendererErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onError = (event: ErrorEvent): void => {
    logError('error.uncaught', event.error ?? event.message, {
      filename: event.filename ?? undefined,
      lineno: event.lineno ?? undefined,
      colno: event.colno ?? undefined,
    });
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    logError('error.unhandled', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

// ---------------------------------------------------------------------------
// Test helpers — exposed but not part of the public API surface.
// ---------------------------------------------------------------------------

export const __testing__ = {
  toErrorPayload,
  safeStringify,
  truncate,
};
