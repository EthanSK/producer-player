/**
 * Active-user counter client.
 *
 * Pings Ethan's Firebase `heartbeat` endpoint on launch + every 5 min while
 * Producer Player is running, so we can keep a live count of currently-active
 * Producer Player users.
 *
 * Server-side counts a session as "active" if `lastSeen < 5 min ago`, so the
 * heartbeat interval here is set to comfortably fit within that window.
 *
 * No PII. The `anonymousId` is a UUID generated locally on first launch and
 * persisted in userData/active-user-id.json (deliberately separate from the
 * unified user-state file so an analytics reset is a one-line delete).
 *
 * Endpoint + design: see ai-wallpaper-backend functions/src/active-users.ts.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';
import log from 'electron-log/main';

const HEARTBEAT_ENDPOINT =
  'https://us-central1-ai-wallpaper-backend.cloudfunctions.net/heartbeat';
const APP_NAME = 'producer-player';
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_TIMEOUT_MS = 8_000;
const ID_FILE_NAME = 'active-user-id.json';

let heartbeatTimer: NodeJS.Timeout | null = null;
let cachedAnonymousId: string | null = null;

function getIdFilePath(): string {
  return join(app.getPath('userData'), ID_FILE_NAME);
}

async function readOrCreateAnonymousId(): Promise<string> {
  if (cachedAnonymousId) return cachedAnonymousId;
  const path = getIdFilePath();
  if (existsSync(path)) {
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { anonymousId?: unknown };
      if (typeof parsed.anonymousId === 'string' && parsed.anonymousId.length > 0) {
        cachedAnonymousId = parsed.anonymousId;
        return cachedAnonymousId;
      }
    } catch (error: unknown) {
      log.warn(
        '[active-user-heartbeat] Failed to read existing anonymous id; regenerating',
        error,
      );
    }
  }
  const id = randomUUID();
  cachedAnonymousId = id;
  try {
    await fs.writeFile(path, JSON.stringify({ anonymousId: id }), 'utf8');
  } catch (error: unknown) {
    log.warn(
      '[active-user-heartbeat] Failed to persist anonymous id; will regenerate next launch',
      error,
    );
  }
  return id;
}

async function sendHeartbeat(anonymousId: string, version: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    const res = await fetch(HEARTBEAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: APP_NAME, anonymousId, version }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn('[active-user-heartbeat] Non-OK response', {
        status: res.status,
      });
      return;
    }
    // We intentionally don't parse / surface the returned count in the UI —
    // this is a fire-and-forget telemetry ping, not a feature.
  } catch (error: unknown) {
    // Network errors, timeouts, offline mode → swallow. We never want a
    // failing heartbeat to bubble up to the user or crash the app.
    log.warn('[active-user-heartbeat] Heartbeat failed', error);
  } finally {
    clearTimeout(timer);
  }
}

export interface StartActiveUserHeartbeatOptions {
  version: string;
  /**
   * When true (test mode, dev environments, etc.) we skip the network ping
   * entirely so e2e tests don't accidentally bump the live counter.
   */
  disabled?: boolean;
}

/**
 * Start the heartbeat loop. Call once during app `ready`.
 * Stops automatically on `before-quit`.
 */
export function startActiveUserHeartbeat(
  options: StartActiveUserHeartbeatOptions,
): void {
  if (options.disabled) {
    log.info('[active-user-heartbeat] Disabled — skipping');
    return;
  }
  if (heartbeatTimer) {
    log.warn('[active-user-heartbeat] Already started — ignoring duplicate call');
    return;
  }

  const tick = async () => {
    try {
      const id = await readOrCreateAnonymousId();
      await sendHeartbeat(id, options.version);
    } catch (error: unknown) {
      log.warn('[active-user-heartbeat] Tick failed', error);
    }
  };

  // Fire immediately on launch, then on a recurring interval.
  void tick();
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  // Don't keep the event loop alive just for telemetry.
  heartbeatTimer.unref?.();

  app.on('before-quit', stopActiveUserHeartbeat);
  log.info('[active-user-heartbeat] Started', {
    intervalMs: HEARTBEAT_INTERVAL_MS,
  });
}

export function stopActiveUserHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    log.info('[active-user-heartbeat] Stopped');
  }
}
