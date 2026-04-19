/**
 * PluginHostService — Electron-main wrapper around the native `pp-audio-host`
 * sidecar (JUCE-based, ships at `native/pp-audio-host/build/bin/pp-audio-host`
 * during development and is bundled into the packaged app in later phases).
 *
 * Phase 1a scope (v3.39):
 *   - Lazy `start()`: spawns the sidecar only when something actually needs
 *     it. Renderers that never open the plugin browser never pay the cost.
 *   - `scanPlugins()`: sends `scan_plugins` and parses the reply into the
 *     shared `ScannedPluginLibrary` shape.
 *   - `stop()`: sends `shutdown` then kills the process.
 *   - `load_plugin` / `unload_plugin` / `setParameter` / `getParameter` /
 *     `processBlock` wrappers exist but surface a clear "not implemented"
 *     error from the sidecar — they land in Phase 2 alongside the real
 *     plugin loading + audio path.
 *
 * The protocol is newline-delimited JSON over the sidecar's stdio:
 *   request  → {"id":n,"method":"<name>","params":{...}}
 *   response → {"id":n,"ok":true,...}  or  {"id":n,"ok":false,"error":"..."}
 *
 * The first line of sidecar stdout is always a `{"event":"ready"}`
 * handshake; the service awaits that before sending any commands so the
 * caller never races on spawn latency.
 */

import { spawn as defaultSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import log from 'electron-log/main';
import type { PluginFormat, PluginInfo, ScannedPluginLibrary } from '@producer-player/contracts';

/**
 * Signature of the `spawn` function we use to launch the sidecar. Exposed
 * as a constructor option so unit tests can inject a fake that returns a
 * scriptable EventEmitter-shaped child without actually running a binary.
 */
export type SpawnFn = typeof defaultSpawn;

type PendingResolver = (value: unknown) => void;
type PendingRejecter = (reason: Error) => void;
interface Pending {
  resolve: PendingResolver;
  reject: PendingRejecter;
}

/** Resolved path to the built sidecar binary, or null when it isn't present. */
export function resolveSidecarBinary(cwd: string = process.cwd()): string | null {
  // Dev: built by `bash native/pp-audio-host/scripts/build-sidecar.sh`.
  // Packaged: copied into `dist/bin/pp-audio-host` via the electron-builder
  // `asarUnpack` rule (wired in Phase 2 alongside the real build step).
  const candidates = [
    resolve(cwd, 'native/pp-audio-host/build/bin/pp-audio-host'),
    resolve(cwd, 'apps/electron/dist/bin/pp-audio-host'),
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore — fall through
    }
  }
  return null;
}

export class PluginHostService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stdoutBuffer = '';
  private binaryPath: string | null;
  private spawnFn: SpawnFn;

  constructor(
    binaryPath: string | null = resolveSidecarBinary(),
    spawnFn: SpawnFn = defaultSpawn,
  ) {
    this.binaryPath = binaryPath;
    this.spawnFn = spawnFn;
  }

  /** True when the sidecar is running (or starting). */
  isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /** True when the sidecar binary is present on disk. */
  isAvailable(): boolean {
    return this.binaryPath !== null;
  }

  /**
   * Lazily spawn the sidecar. Safe to call multiple times; concurrent
   * callers get the same readiness promise.
   */
  async start(): Promise<void> {
    if (this.child && !this.child.killed) return this.readyPromise ?? Promise.resolve();
    if (!this.binaryPath) {
      throw new Error(
        'pp-audio-host binary not found. Run `bash native/pp-audio-host/scripts/build-sidecar.sh` once to bootstrap it.',
      );
    }

    const child = this.spawnFn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdoutChunk(chunk));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      log.info(`[plugin-host] stderr: ${chunk.trimEnd()}`);
    });

    child.on('exit', (code, signal) => {
      log.info(`[plugin-host] exited (code=${code}, signal=${signal})`);
      for (const pending of this.pending.values()) {
        pending.reject(new Error('pp-audio-host exited before reply'));
      }
      this.pending.clear();
      this.child = null;
      this.readyPromise = null;
    });

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      // The sidecar emits {"event":"ready"} on first line; we hook into the
      // same parser that handles regular replies by installing a
      // one-shot handler keyed on a sentinel id.
      const timer = setTimeout(() => {
        rejectReady(new Error('pp-audio-host did not signal ready within 10s'));
      }, 10_000);

      this.readyHandler = () => {
        clearTimeout(timer);
        resolveReady();
      };
    });

    return this.readyPromise;
  }

  private readyHandler: (() => void) | null = null;

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nl = this.stdoutBuffer.indexOf('\n');
      if (nl < 0) break;
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line.length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log.warn(`[plugin-host] failed to parse line: ${line}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const obj = parsed as Record<string, unknown>;

    if (obj.event === 'ready') {
      if (this.readyHandler) {
        this.readyHandler();
        this.readyHandler = null;
      }
      return;
    }

    if (typeof obj.id === 'number') {
      const pending = this.pending.get(obj.id);
      if (!pending) return;
      this.pending.delete(obj.id);
      if (obj.ok === true) {
        pending.resolve(obj);
      } else {
        const message = typeof obj.error === 'string' ? obj.error : 'sidecar returned failure';
        pending.reject(new Error(message));
      }
    }
  }

  private async send<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    await this.start();
    if (!this.child) throw new Error('pp-audio-host not running');

    const id = this.nextId++;
    const payload = `${JSON.stringify({ id, method, params })}\n`;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: (v) => resolvePromise(v as T),
        reject: rejectPromise,
      });
      try {
        this.child!.stdin.write(payload);
      } catch (err) {
        this.pending.delete(id);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Run a plugin-folder scan and return a fresh `ScannedPluginLibrary`.
   * Uses OS-default folders when called with no arguments (matches the
   * sidecar's built-in defaults on macOS).
   */
  async scanPlugins(opts?: { format?: 'vst3' | 'au' | 'all'; paths?: string[] }): Promise<ScannedPluginLibrary> {
    const reply = await this.send<Record<string, unknown>>('scan_plugins', opts ?? {});
    const pluginsRaw = Array.isArray(reply.plugins) ? (reply.plugins as unknown[]) : [];
    const plugins: PluginInfo[] = pluginsRaw.flatMap((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
      const entry = p as Record<string, unknown>;
      const id = typeof entry.id === 'string' ? entry.id : null;
      const name = typeof entry.name === 'string' ? entry.name : null;
      const formatStr = typeof entry.format === 'string' ? entry.format : null;
      const path = typeof entry.path === 'string' ? entry.path : null;
      if (!id || !name || !formatStr || !path) return [];
      if (formatStr !== 'vst3' && formatStr !== 'au' && formatStr !== 'clap') return [];
      const format: PluginFormat = formatStr;
      const info: PluginInfo = {
        id,
        name,
        vendor: typeof entry.vendor === 'string' ? entry.vendor : '',
        format,
        version: typeof entry.version === 'string' ? entry.version : '',
        path,
        categories: Array.isArray(entry.categories)
          ? (entry.categories as unknown[]).filter((c): c is string => typeof c === 'string' && c.length > 0)
          : [],
        isSupported: typeof entry.isSupported === 'boolean' ? entry.isSupported : true,
        failureReason:
          typeof entry.failureReason === 'string' && entry.failureReason.length > 0
            ? entry.failureReason
            : null,
      };
      return [info];
    });
    const scanVersion =
      typeof reply.scanVersion === 'number' && Number.isFinite(reply.scanVersion)
        ? (reply.scanVersion as number)
        : 1;
    return {
      plugins,
      scannedAt: new Date().toISOString(),
      scanVersion,
    };
  }

  async loadPlugin(_trackId: string, _slot: number, _pluginId: string): Promise<never> {
    await this.send('load_plugin', { trackId: _trackId, slot: _slot, pluginId: _pluginId });
    throw new Error('unreachable — sidecar is expected to reject load_plugin in Phase 1a');
  }

  async unloadPlugin(_trackId: string, _slot: number): Promise<never> {
    await this.send('unload_plugin', { trackId: _trackId, slot: _slot });
    throw new Error('unreachable — sidecar is expected to reject unload_plugin in Phase 1a');
  }

  async setParameter(_trackId: string, _slot: number, _paramId: number, _value: number): Promise<never> {
    await this.send('set_parameter', { trackId: _trackId, slot: _slot, paramId: _paramId, value: _value });
    throw new Error('unreachable — set_parameter is Phase 2');
  }

  async getParameter(_trackId: string, _slot: number, _paramId: number): Promise<never> {
    await this.send('get_parameter', { trackId: _trackId, slot: _slot, paramId: _paramId });
    throw new Error('unreachable — get_parameter is Phase 2');
  }

  async processBlock(): Promise<never> {
    await this.send('process_block');
    throw new Error('unreachable — process_block is Phase 2');
  }

  /** Tell the sidecar to flush + exit, then kill the process if needed. */
  async stop(): Promise<void> {
    if (!this.child || this.child.killed) return;
    try {
      await this.send('shutdown').catch(() => undefined);
    } finally {
      if (this.child && !this.child.killed) {
        this.child.kill('SIGTERM');
        this.child = null;
      }
    }
  }
}
