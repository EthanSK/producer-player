/**
 * PluginHostService — Electron-main wrapper around the native `pp-audio-host`
 * sidecar (JUCE-based, ships at `native/pp-audio-host/build/bin/pp-audio-host`
 * during development and is bundled into the packaged app in later phases).
 *
 * Phase 2 scope (v3.41):
 *   - Lazy `start()`: spawns the sidecar only when something actually needs
 *     it. Renderers that never open the plugin browser never pay the cost.
 *   - `scanPlugins()`: sends `scan_plugins` and parses the reply into the
 *     shared `ScannedPluginLibrary` shape.
 *   - `loadPlugin()` / `unloadPlugin()`: real lifecycle commands, with the
 *     sidecar instantiating (and later `releaseResources`-ing) JUCE plugin
 *     instances keyed by the renderer-supplied stable `instanceId`.
 *   - `reconcileTrackChain()`: diff-and-apply the desired chain against the
 *     current set of loaded plugin instances — load new slots, unload
 *     removed ones, leave unchanged ones alone. This is the single path
 *     that Electron-main uses when a track is opened or the chain is edited.
 *   - `processBlock()`: round-trip a stereo float32 buffer through the
 *     enabled slots in order. Used only when the renderer chooses the
 *     sidecar audio route (empty/all-disabled chains short-circuit in the
 *     renderer — see `App.tsx` / Phase 2.5).
 *   - `setParameter()` / `getParameter()` / `get_plugin_state` /
 *     `set_plugin_state`: minimal wrappers so Phase 3 (automation) and
 *     Phase 4 (preset persistence) can plug in without reshaping the protocol.
 *   - `stop()`: sends `shutdown` then kills the process.
 *
 * The protocol is newline-delimited JSON over the sidecar's stdio:
 *   request  → {"id":n,"method":"<name>","params":{...}}
 *   response → {"id":n,"ok":true,...}  or  {"id":n,"ok":false,"error":"..."}
 *
 * The first line of sidecar stdout is always a `{"event":"ready"}`
 * handshake; the service awaits that before sending any commands so the
 * caller never races on spawn latency.
 *
 * Ethan's invariant: **if the chain has zero enabled plugins, audio must
 * pass through unchanged.** Enforced at two layers:
 *   1. The renderer skips the sidecar entirely when
 *      `chain.items.filter(i => i.enabled).length === 0` — zero IPC,
 *      zero added latency. That's the real fast path.
 *   2. Even if a caller does invoke `processBlock` on an empty/all-disabled
 *      chain, the sidecar short-circuits to a memcpy-style passthrough.
 *      See `handleProcessBlock` in `native/pp-audio-host/src/main.cpp`.
 */

import { spawn as defaultSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, normalize, resolve } from 'node:path';
import log from 'electron-log/main';
import type {
  PluginChainItem,
  PluginFormat,
  PluginInfo,
  ScannedPluginLibrary,
  TrackPluginChain,
} from '@producer-player/contracts';

/**
 * Signature of the `spawn` function we use to launch the sidecar. Exposed
 * as a constructor option so unit tests can inject a fake that returns a
 * scriptable EventEmitter-shaped child without actually running a binary.
 */
export type SpawnFn = typeof defaultSpawn;

export type PluginScanFormat = PluginFormat | 'all';

export interface GlobalPluginScanRoot {
  format: Exclude<PluginFormat, 'clap'>;
  path: string;
}

export interface GlobalPluginDiscoveryResult {
  plugins: PluginInfo[];
  searchedPaths: string[];
  skippedPaths: Array<{ path: string; reason: string }>;
}

interface DiscoverGlobalPluginOptions {
  format?: PluginScanFormat;
  paths?: string[];
  maxDepth?: number;
}

interface NormalizedScanOptions {
  format: PluginScanFormat;
  paths: string[];
}

type PendingResolver = (value: unknown) => void;
type PendingRejecter = (reason: Error) => void;
interface Pending {
  resolve: PendingResolver;
  reject: PendingRejecter;
  timer: NodeJS.Timeout;
}

const DEFAULT_PLUGIN_SCAN_MAX_DEPTH = 4;
const PLUGIN_SCAN_VERSION = 2;

const HOSTABLE_PLUGIN_EXTENSIONS: Record<string, Exclude<PluginFormat, 'clap'>> = {
  '.vst3': 'vst3',
  '.component': 'au',
};

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function defaultGlobalPluginScanRoots(
  opts: { homeDirectory?: string; platform?: NodeJS.Platform; format?: PluginScanFormat } = {},
): GlobalPluginScanRoot[] {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') return [];

  const homeDirectory = opts.homeDirectory ?? homedir();
  const roots: GlobalPluginScanRoot[] = [
    { format: 'vst3', path: join(homeDirectory, 'Library/Audio/Plug-Ins/VST3') },
    { format: 'vst3', path: '/Library/Audio/Plug-Ins/VST3' },
    { format: 'au', path: join(homeDirectory, 'Library/Audio/Plug-Ins/Components') },
    { format: 'au', path: '/Library/Audio/Plug-Ins/Components' },
  ];

  const format = opts.format ?? 'all';
  return roots.filter((root) => format === 'all' || root.format === format);
}

export function defaultGlobalPluginScanPaths(format: PluginScanFormat = 'all'): string[] {
  return uniqueStrings(defaultGlobalPluginScanRoots({ format }).map((root) => root.path));
}

function normalizeScanOptions(opts?: { format?: PluginScanFormat; paths?: string[] }): NormalizedScanOptions {
  const format = opts?.format ?? 'all';
  const paths = opts?.paths && opts.paths.length > 0 ? opts.paths : defaultGlobalPluginScanPaths(format);
  return {
    format,
    paths: uniqueStrings(paths.map((path) => path.trim()).filter(Boolean)),
  };
}

function formatMatches(requested: PluginScanFormat, candidate: PluginFormat): boolean {
  return requested === 'all' || requested === candidate;
}

function pluginNameFromPath(path: string): string {
  const ext = extname(path);
  return basename(path, ext).trim() || basename(path).trim() || 'Unknown plugin';
}

function pluginIdFromPath(format: PluginFormat, path: string): string {
  const normalizedPath = normalize(path).toLowerCase();
  const digest = createHash('sha256').update(`${format}:${normalizedPath}`).digest('hex').slice(0, 16);
  return `${format}:fs-${digest}`;
}

function pluginInfoFromPath(format: PluginFormat, path: string): PluginInfo {
  return {
    id: pluginIdFromPath(format, path),
    name: pluginNameFromPath(path),
    vendor: '',
    format,
    version: '',
    path,
    categories: [],
    isSupported: true,
    failureReason: null,
  };
}

function pathLooksLikePluginBundle(path: string): PluginFormat | null {
  const format = HOSTABLE_PLUGIN_EXTENSIONS[extname(path).toLowerCase()];
  return format ?? null;
}

export function discoverGlobalPlugins(opts: DiscoverGlobalPluginOptions = {}): GlobalPluginDiscoveryResult {
  const requestedFormat = opts.format ?? 'all';
  const paths = opts.paths && opts.paths.length > 0 ? opts.paths : defaultGlobalPluginScanPaths(requestedFormat);
  const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? DEFAULT_PLUGIN_SCAN_MAX_DEPTH));
  const searchedPaths = uniqueStrings(paths.map((path) => path.trim()).filter(Boolean));
  const skippedPaths: Array<{ path: string; reason: string }> = [];
  const pluginsByPath = new Map<string, PluginInfo>();

  const visit = (path: string, depth: number) => {
    const directFormat = pathLooksLikePluginBundle(path);
    if (directFormat) {
      try {
        if (!existsSync(path)) {
          skippedPaths.push({ path, reason: 'missing' });
          return;
        }
      } catch (err) {
        skippedPaths.push({ path, reason: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (formatMatches(requestedFormat, directFormat)) {
        pluginsByPath.set(normalize(path).toLowerCase(), pluginInfoFromPath(directFormat, path));
      }
      // Plugin bundles are directories; don't recurse into Contents/.
      return;
    }
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      if (!existsSync(path)) {
        skippedPaths.push({ path, reason: 'missing' });
        return;
      }
      const stats = statSync(path);
      if (!stats.isDirectory()) return;
      entries = readdirSync(path);
    } catch (err) {
      skippedPaths.push({ path, reason: err instanceof Error ? err.message : String(err) });
      return;
    }

    for (const entry of entries) {
      visit(join(path, entry), depth + 1);
    }
  };

  for (const path of searchedPaths) visit(path, 0);

  return {
    plugins: Array.from(pluginsByPath.values()).sort((a, b) => {
      const name = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (name !== 0) return name;
      return a.path.localeCompare(b.path);
    }),
    searchedPaths,
    skippedPaths,
  };
}

function sidecarPluginPaths(plugins: readonly PluginInfo[]): Set<string> {
  const paths = new Set<string>();
  for (const plugin of plugins) {
    if (plugin.path) paths.add(normalize(plugin.path).toLowerCase());
  }
  return paths;
}

function mergeWithFilesystemDiscovery(
  plugins: PluginInfo[],
  discovery: GlobalPluginDiscoveryResult,
): PluginInfo[] {
  if (plugins.length > 0) return plugins;
  if (discovery.plugins.length === 0) return plugins;

  const existingPaths = sidecarPluginPaths(plugins);
  const merged = [...plugins];
  for (const plugin of discovery.plugins) {
    const key = normalize(plugin.path).toLowerCase();
    if (existingPaths.has(key)) continue;
    existingPaths.add(key);
    merged.push(plugin);
  }
  return merged;
}

/**
 * Ordered list of filesystem paths we look at to find the sidecar binary.
 * Dev: built by `bash native/pp-audio-host/scripts/build-sidecar.sh` into
 * `native/pp-audio-host/build/bin/pp-audio-host` (`.exe` on Windows).
 * Packaged: copied into `apps/electron/dist/bin/pp-audio-host` by
 * `apps/electron/scripts/build-main.mjs`, then captured by electron-builder's
 * `asarUnpack: ["apps/electron/dist/bin/**"]` rule.
 */
export function resolveSidecarBinaryCandidates(cwd: string = process.cwd()): string[] {
  const binaryName = process.platform === 'win32' ? 'pp-audio-host.exe' : 'pp-audio-host';
  return [
    resolve(cwd, 'native/pp-audio-host/build/bin', binaryName),
    resolve(cwd, 'apps/electron/dist/bin', binaryName),
  ];
}

/** Resolved path to the built sidecar binary, or null when it isn't present. */
export function resolveSidecarBinary(cwd: string = process.cwd()): string | null {
  const candidates = resolveSidecarBinaryCandidates(cwd);
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

export interface LoadPluginOptions {
  instanceId: string;
  pluginPath: string;
  format: PluginFormat;
  sampleRate?: number;
  blockSize?: number;
}

export interface LoadPluginResult {
  instanceId: string;
  reportedLatencySamples: number;
  numInputs: number;
  numOutputs: number;
  alreadyLoaded?: boolean;
}

export interface PluginInstanceLoadedPayload {
  instanceId: string;
  reportedLatencySamples: number;
}

export interface ProcessBlockItem {
  instanceId: string;
  enabled: boolean;
}

export interface ProcessBlockResult {
  frames: number;
  channels: number;
  bufferBase64: string;
  processedSlots: number;
}

/**
 * Result of `openPluginEditor`. `alreadyOpen` is true if the window was
 * already visible — the sidecar just brings it to the front in that case.
 */
export interface OpenEditorResult {
  instanceId: string;
  alreadyOpen: boolean;
}

/**
 * Listener for unsolicited `editor_closed` events the sidecar emits when
 * the user clicks the OS close button on a plugin-editor window. The
 * renderer needs this so its "open" state clears without the user having
 * to re-click the in-app Edit button.
 */
export type EditorClosedListener = (instanceId: string) => void;
export type InstanceLoadedListener = (payload: PluginInstanceLoadedPayload) => void;
export type SidecarExitedListener = (info: { code: number | null; signal: string | null; expected: boolean }) => void;

/**
 * Plan produced by `diffChainReconciliation`. Split out so tests can
 * assert the diff logic without touching the sidecar.
 */
export interface ChainReconciliationPlan {
  toLoad: Array<{ instanceId: string; pluginId: string; state?: string }>;
  toUnload: string[];
  unchanged: string[];
}

/**
 * Compute the set of instance operations needed to bring the loaded plugin
 * set from `loaded` to whatever the desired chain lists. Pure function so
 * the unit tests can exercise it without any IPC.
 *
 * - A slot whose `instanceId` is already loaded is a no-op regardless of
 *   its `pluginId` (the renderer treats `instanceId` as the stable key).
 * - Slots that are newly present → `toLoad`.
 * - Loaded instances that the chain no longer references → `toUnload`.
 *   Disabled slots are kept loaded so toggling back on is instant — the
 *   renderer's `chain` payload in `process_block` controls whether the
 *   instance actually runs on audio.
 */
export function diffChainReconciliation(
  loaded: ReadonlySet<string>,
  desired: ReadonlyArray<PluginChainItem>,
): ChainReconciliationPlan {
  const toLoad: ChainReconciliationPlan['toLoad'] = [];
  const unchanged: string[] = [];
  const desiredIds = new Set<string>();
  for (const item of desired) {
    if (!item.instanceId || !item.pluginId) continue;
    desiredIds.add(item.instanceId);
    if (loaded.has(item.instanceId)) {
      unchanged.push(item.instanceId);
    } else {
      toLoad.push({
        instanceId: item.instanceId,
        pluginId: item.pluginId,
        ...(item.state !== undefined ? { state: item.state } : {}),
      });
    }
  }
  const toUnload: string[] = [];
  for (const id of loaded) {
    if (!desiredIds.has(id)) toUnload.push(id);
  }
  return { toLoad, toUnload, unchanged };
}

export class PluginHostService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stdoutBuffer = '';
  private binaryPath: string | null;
  private spawnFn: SpawnFn;
  /** Instance ids currently live inside the sidecar. */
  private loadedInstances = new Set<string>();
  /** Cached plugin library, set by `rememberLibrary` so the service can resolve pluginId → path without a round-trip. */
  private cachedLibrary: ScannedPluginLibrary | null = null;
  private reconciliationTail: Promise<void> = Promise.resolve();
  /**
   * v3.42 Phase 3 — listeners for `editor_closed` events the sidecar pushes
   * when the user closes a plugin-editor window via the OS close button.
   * main.ts registers one listener that forwards to the renderer.
   */
  private editorClosedListeners = new Set<EditorClosedListener>();
  private instanceLoadedListeners = new Set<InstanceLoadedListener>();
  private sidecarExitedListeners = new Set<SidecarExitedListener>();
  /** Editor instance ids currently open (tracked from open/close requests + editor_closed events). */
  private openEditorIds = new Set<string>();
  private instanceLatencies = new Map<string, number>();
  private expectingExit = false;

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

  /** Path of the sidecar binary we'd spawn, or null if none was found. */
  getBinaryPath(): string | null {
    return this.binaryPath;
  }

  /** Snapshot of currently loaded instance ids. Exposed for tests. */
  getLoadedInstanceIds(): string[] {
    return Array.from(this.loadedInstances);
  }

  getInstanceLatencies(): Record<string, number> {
    return Object.fromEntries(this.instanceLatencies);
  }

  /**
   * Stash the library so `loadPlugin(pluginId, instanceId)` can look up a
   * plugin's filesystem path + format without a sidecar round-trip. Called
   * by the main-process IPC layer after every successful scan + on startup
   * once the persisted library has been loaded from state.
   */
  rememberLibrary(library: ScannedPluginLibrary | null): void {
    this.cachedLibrary = library;
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
        clearTimeout(pending.timer);
        pending.reject(new Error('pp-audio-host exited before reply'));
      }
      this.pending.clear();
      // All sidecar-owned state is gone; the diff logic will reload next
      // time the renderer asks for a processed block / reconciles a chain.
      this.loadedInstances.clear();
      this.instanceLatencies.clear();
      // Surface "editor is no longer open" for every tracked editor so the
      // renderer doesn't get stuck with an open-state badge pointing at a
      // dead sidecar.
      this.notifyTrackedEditorsClosed('during exit');
      const expected = this.expectingExit;
      this.expectingExit = false;
      for (const listener of this.sidecarExitedListeners) {
        try {
          listener({ code, signal, expected });
        } catch (err) {
          log.warn('[plugin-host] sidecar exit listener threw', err);
        }
      }
      this.child = null;
      this.readyPromise = null;
    });

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      // The sidecar emits {"event":"ready"} on first line; we hook into the
      // same parser that handles regular replies by installing a
      // one-shot handler keyed on a sentinel id.
      const timer = setTimeout(() => {
        this.readyHandler = null;
        if (this.child && !this.child.killed) {
          this.expectingExit = true;
          this.child.kill('SIGTERM');
        }
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

  private notifyTrackedEditorsClosed(context: string): void {
    const stale = Array.from(this.openEditorIds);
    this.openEditorIds.clear();
    for (const instanceId of stale) {
      for (const listener of this.editorClosedListeners) {
        try {
          listener(instanceId);
        } catch (err) {
          log.warn(`[plugin-host] editor_closed listener threw ${context}`, err);
        }
      }
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
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

    // v3.42 Phase 3 — unsolicited editor_closed event from the sidecar.
    // No `id` because the renderer never asked for it (user clicked the
    // OS close button). Notify listeners so React state can clear the
    // per-slot "open" indicator.
    if (obj.event === 'editor_closed') {
      const instanceId = typeof obj.instanceId === 'string' ? obj.instanceId : null;
      if (instanceId) {
        this.openEditorIds.delete(instanceId);
        for (const listener of this.editorClosedListeners) {
          try {
            listener(instanceId);
          } catch (err) {
            log.warn('[plugin-host] editor_closed listener threw', err);
          }
        }
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

  private async send<T = unknown>(
    method: string,
    params: unknown = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    await this.start();
    if (!this.child) throw new Error('pp-audio-host not running');

    const id = this.nextId++;
    const payload = `${JSON.stringify({ id, method, params })}\n`;
    const timeoutMs = opts.timeoutMs ?? 30_000;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.child && !this.child.killed) {
          this.expectingExit = true;
          this.child.kill('SIGTERM');
        }
        rejectPromise(new Error(`pp-audio-host ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolvePromise(v as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
        timer,
      });
      try {
        this.child!.stdin.write(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Run a global installed-plugin scan and return a fresh `ScannedPluginLibrary`.
   * With no arguments we explicitly scan the standard macOS VST3/AU install
   * folders (user + machine-wide), matching a DAW-style global plugin browser
   * instead of any Producer Player project/library-local directory.
   */
  async scanPlugins(opts?: { format?: PluginScanFormat; paths?: string[] }): Promise<ScannedPluginLibrary> {
    const scanOptions = normalizeScanOptions(opts);
    log.info(
      `[plugin-host] scanPlugins starting (format=${scanOptions.format}, paths=${
        scanOptions.paths.length > 0 ? scanOptions.paths.join('|') : 'none'
      })`,
    );
    const reply = await this.send<Record<string, unknown>>('scan_plugins', scanOptions, { timeoutMs: 120_000 });
    // v3.50 — surface sidecar-reported scan failures in the main log so a
    // "Plugin scan failed" toast has something to point at beyond the
    // generic error message. main.cpp's handleScanPlugins fills `failed`
    // with {path, failureReason} for every plugin file that errored.
    const failedRaw = Array.isArray(reply.failed) ? (reply.failed as unknown[]) : [];
    if (failedRaw.length > 0) {
      const preview = failedRaw.slice(0, 5).map((failure) => {
        if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return 'unknown failure';
        const entry = failure as Record<string, unknown>;
        const path = typeof entry.path === 'string' && entry.path.length > 0 ? entry.path : 'unknown path';
        const reason =
          typeof entry.failureReason === 'string' && entry.failureReason.length > 0
            ? entry.failureReason
            : 'unknown reason';
        return `${path} (${reason})`;
      });
      log.warn(
        `[plugin-host] scan reported ${failedRaw.length} failed entries (showing up to 5): ${preview.join('; ')}`,
      );
    }
    const pluginsRaw = Array.isArray(reply.plugins) ? (reply.plugins as unknown[]) : [];
    let plugins: PluginInfo[] = pluginsRaw.flatMap((p) => {
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
    const discovery = discoverGlobalPlugins(scanOptions);
    if (plugins.length === 0 && discovery.plugins.length > 0) {
      log.info(
        `[plugin-host] sidecar returned no plugin metadata; using filesystem global discovery fallback (${discovery.plugins.length} bundles)`,
      );
    }
    if (discovery.skippedPaths.length > 0) {
      const skippedPreview = discovery.skippedPaths
        .filter((entry) => entry.reason !== 'missing')
        .slice(0, 5)
        .map((entry) => `${entry.path} (${entry.reason})`);
      if (skippedPreview.length > 0) {
        log.warn(`[plugin-host] skipped unreadable plugin scan paths: ${skippedPreview.join('; ')}`);
      }
    }
    plugins = mergeWithFilesystemDiscovery(plugins, discovery);

    const scanVersion =
      typeof reply.scanVersion === 'number' && Number.isFinite(reply.scanVersion)
        ? Math.max(reply.scanVersion as number, PLUGIN_SCAN_VERSION)
        : PLUGIN_SCAN_VERSION;
    const library: ScannedPluginLibrary = {
      plugins,
      scannedAt: new Date().toISOString(),
      scanVersion,
    };
    this.rememberLibrary(library);
    return library;
  }

  /**
   * Load one plugin slot into the sidecar. `instanceId` is the stable UUID
   * the renderer issued when the slot was added; it survives reorders and
   * toggles so reconciliation just needs to compare sets of ids.
   */
  async loadPlugin(opts: LoadPluginOptions): Promise<LoadPluginResult> {
    const reply = await this.send<Record<string, unknown>>('load_plugin', opts, { timeoutMs: 60_000 });
    this.loadedInstances.add(opts.instanceId);
    const reportedLatencySamples = Number(reply.reportedLatencySamples) || 0;
    this.instanceLatencies.set(opts.instanceId, reportedLatencySamples);
    return {
      instanceId: opts.instanceId,
      reportedLatencySamples,
      numInputs: Number(reply.numInputs) || 2,
      numOutputs: Number(reply.numOutputs) || 2,
      alreadyLoaded: Boolean(reply.alreadyLoaded),
    };
  }

  /** Drop one plugin slot from the sidecar. Idempotent — unknown ids are fine. */
  async unloadPlugin(instanceId: string): Promise<void> {
    await this.send('unload_plugin', { instanceId }, { timeoutMs: 10_000 });
    this.loadedInstances.delete(instanceId);
    this.instanceLatencies.delete(instanceId);
    // The sidecar also closes any open editor for this instance and emits
    // an editor_closed event, which clears openEditorIds via handleLine.
    // Belt-and-suspenders: drop it here too in case the event is in flight.
    this.openEditorIds.delete(instanceId);
  }

  /**
   * Apply the desired chain against what's loaded, using `diffChainReconciliation`.
   * - Newly-present slots are looked up in the cached library to get their
   *   filesystem path + format, then sent as `load_plugin`.
   * - Slots no longer referenced are `unload_plugin`ed.
   * - Unchanged slots are left alone (including disabled ones — bypass is a
   *   runtime flag, not a lifecycle event).
   *
   * Returns the set of changes that were applied. Throws only if the sidecar
   * connection fails; per-slot failures are collected and reported.
   */
  async reconcileTrackChain(
    chain: TrackPluginChain,
    opts: { sampleRate?: number; blockSize?: number } = {},
  ): Promise<{ loaded: string[]; unloaded: string[]; failed: Array<{ instanceId: string; error: string }> }> {
    const queued = this.reconciliationTail
      .catch(() => undefined)
      .then(() => this.reconcileTrackChainNow(chain, opts));
    this.reconciliationTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async reconcileTrackChainNow(
    chain: TrackPluginChain,
    opts: { sampleRate?: number; blockSize?: number } = {},
  ): Promise<{ loaded: string[]; unloaded: string[]; failed: Array<{ instanceId: string; error: string }> }> {
    const plan = diffChainReconciliation(this.loadedInstances, chain.items);
    const failed: Array<{ instanceId: string; error: string }> = [];
    const loadedOk: string[] = [];
    const unloadedOk: string[] = [];

    // Unload first so we free resources before (potentially) loading more.
    for (const instanceId of plan.toUnload) {
      try {
        await this.unloadPlugin(instanceId);
        unloadedOk.push(instanceId);
      } catch (err) {
        failed.push({ instanceId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    for (const { instanceId, pluginId, state } of plan.toLoad) {
      const info = this.cachedLibrary?.plugins.find((p) => p.id === pluginId) ?? null;
      if (!info) {
        failed.push({ instanceId, error: `pluginId ${pluginId} not found in cached library — re-scan required` });
        continue;
      }
      try {
        const loaded = await this.loadPlugin({
          instanceId,
          pluginPath: info.path,
          format: info.format,
          sampleRate: opts.sampleRate,
          blockSize: opts.blockSize,
        });
        for (const listener of this.instanceLoadedListeners) {
          try {
            listener({
              instanceId,
              reportedLatencySamples: loaded.reportedLatencySamples,
            });
          } catch (err) {
            log.warn('[plugin-host] instance loaded listener threw', err);
          }
        }
        // v3.43 Phase 4 — rehydrate persisted preset/plugin state after a
        // cold load so recalled presets survive app relaunches.
        if (typeof state === 'string') await this.setPluginState(instanceId, state);
        loadedOk.push(instanceId);
      } catch (err) {
        failed.push({ instanceId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { loaded: loadedOk, unloaded: unloadedOk, failed };
  }

  /**
   * Send a stereo float32 block through the enabled slots of `chain`, in
   * order. Returns the processed buffer (base64-encoded float32 interleaved).
   *
   * Passing an empty chain or a chain with every slot disabled still returns
   * the input verbatim — the sidecar short-circuits — but the renderer is
   * expected to skip this IPC entirely in that case (see App.tsx). This
   * double-enforcement matches Ethan's "zero plugins → zero effect" invariant.
   */
  async processBlock(opts: {
    chain: ProcessBlockItem[];
    bufferBase64: string;
    frames: number;
    channels?: number;
    sampleRate?: number;
    blockSize?: number;
  }): Promise<ProcessBlockResult> {
    const reply = await this.send<Record<string, unknown>>('process_block', {
      chain: opts.chain,
      bufferBase64: opts.bufferBase64,
      frames: opts.frames,
      channels: opts.channels ?? 2,
      sampleRate: opts.sampleRate,
      blockSize: opts.blockSize,
    });
    return {
      frames: Number(reply.frames) || opts.frames,
      channels: Number(reply.channels) || opts.channels || 2,
      bufferBase64: typeof reply.bufferBase64 === 'string' ? (reply.bufferBase64 as string) : '',
      processedSlots: Number(reply.processedSlots) || 0,
    };
  }

  async setParameter(instanceId: string, paramIndex: number, value: number): Promise<void> {
    await this.send('set_parameter', { instanceId, paramIndex, value }, { timeoutMs: 10_000 });
  }

  async getParameter(instanceId: string, paramIndex: number): Promise<number> {
    const reply = await this.send<Record<string, unknown>>(
      'get_parameter',
      { instanceId, paramIndex },
      { timeoutMs: 10_000 },
    );
    return typeof reply.value === 'number' ? (reply.value as number) : 0;
  }

  async getPluginState(instanceId: string): Promise<string> {
    const reply = await this.send<Record<string, unknown>>('get_plugin_state', { instanceId }, { timeoutMs: 10_000 });
    return typeof reply.stateBase64 === 'string' ? (reply.stateBase64 as string) : '';
  }

  async setPluginState(instanceId: string, stateBase64: string): Promise<void> {
    await this.send('set_plugin_state', { instanceId, stateBase64 }, { timeoutMs: 10_000 });
  }

  // -------------------------------------------------------------------------
  // v3.42 Phase 3 — plugin editor window control.
  //
  // The sidecar owns the JUCE AudioProcessorEditor + its DocumentWindow.
  // The renderer just asks us to open/close by instanceId and listens for
  // `editor_closed` events so it can clear the per-slot "open" indicator
  // when the user closes the window via the OS close button.
  //
  // Safe-edge behavior:
  //   - Unknown instanceId → sidecar returns error ("not loaded"), we
  //     surface it as a rejected promise. The renderer rolls back its
  //     optimistic open marker if this happens during load/unload races.
  //   - open_editor is idempotent: calling twice while the window is
  //     already visible just brings it to the front (alreadyOpen=true).
  //   - close_editor is idempotent: closing an already-closed editor
  //     returns wasOpen=false.
  // -------------------------------------------------------------------------

  async openPluginEditor(instanceId: string): Promise<OpenEditorResult> {
    if (!instanceId) {
      throw new Error('openPluginEditor: instanceId is required');
    }
    const reply = await this.send<Record<string, unknown>>(
      'open_editor',
      { instanceId },
      { timeoutMs: 15_000 },
    );
    this.openEditorIds.add(instanceId);
    return {
      instanceId,
      alreadyOpen: Boolean(reply.alreadyOpen),
    };
  }

  async closePluginEditor(instanceId: string): Promise<void> {
    if (!instanceId) return;
    await this.send('close_editor', { instanceId }, { timeoutMs: 10_000 });
    this.openEditorIds.delete(instanceId);
  }

  getOpenEditorIds(): string[] {
    return Array.from(this.openEditorIds);
  }

  /**
   * Subscribe to `editor_closed` events. Returns an unsubscribe function
   * (matches the pattern used elsewhere in the codebase for renderer
   * event listeners).
   */
  onEditorClosed(listener: EditorClosedListener): () => void {
    this.editorClosedListeners.add(listener);
    return () => {
      this.editorClosedListeners.delete(listener);
    };
  }

  onInstanceLoaded(listener: InstanceLoadedListener): () => void {
    this.instanceLoadedListeners.add(listener);
    return () => {
      this.instanceLoadedListeners.delete(listener);
    };
  }

  onSidecarExited(listener: SidecarExitedListener): () => void {
    this.sidecarExitedListeners.add(listener);
    return () => {
      this.sidecarExitedListeners.delete(listener);
    };
  }

  /** Tell the sidecar to flush + exit, then kill the process if needed. */
  async stop(): Promise<void> {
    if (!this.child || this.child.killed) return;
    this.expectingExit = true;
    try {
      await this.send('shutdown').catch(() => undefined);
    } finally {
      if (this.child && !this.child.killed) {
        this.expectingExit = true;
        this.child.kill('SIGTERM');
        this.child = null;
      }
      this.loadedInstances.clear();
      this.instanceLatencies.clear();
      this.notifyTrackedEditorsClosed('during stop');
    }
  }
}
