/**
 * Agent UI Control — IPC surface for the embedded "Producee Boy" agent so it
 * can read and drive the renderer UI directly.
 *
 * Three primitives:
 *   - pp_run_js          arbitrary JS evaluation in the renderer with timeout
 *                        + size cap.
 *   - pp_screenshot      PNG of the main window (data: URL) for visual ground
 *                        truth.
 *   - pp_dom_snapshot    structured tree of visible interactive elements
 *                        ({tag, testid, label, role, text, bounds, children}).
 *                        Cheap-to-reason-about alternative to a screenshot.
 *
 * All three are gated behind `ENABLE_AGENT_FEATURES` (already runtime-flagged
 * in contracts) and log a single line per call to electron-log so we can
 * audit later. The handlers never throw across the IPC boundary — they always
 * resolve with a discriminated `{ ok: true, ... } | { ok: false, error }`
 * envelope so the renderer (and the agent CLI subprocess that ultimately
 * issues these commands) can decide how to surface failures.
 */
import type { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import type {
  AgentDomSnapshotPayload,
  AgentDomSnapshotResult,
  AgentRunJsPayload,
  AgentRunJsResult,
  AgentScreenshotPayload,
  AgentScreenshotResult,
} from '@producer-player/contracts';

// Hard limits. Conservative; bumpable if we hit real-world friction.
const RUN_JS_DEFAULT_TIMEOUT_MS = 5_000;
const RUN_JS_MAX_TIMEOUT_MS = 30_000;
const RUN_JS_MAX_CODE_BYTES = 100 * 1024; // 100 KB of source
const RUN_JS_MAX_RESULT_BYTES = 100 * 1024; // 100 KB of stringified result
const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB of PNG
const DOM_SNAPSHOT_DEFAULT_MAX_NODES = 500;
const DOM_SNAPSHOT_HARD_MAX_NODES = 2_000;

const LOG_TAG = '[pp:agent-ui]';

function clampTimeout(input: number | undefined): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return RUN_JS_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(input), RUN_JS_MAX_TIMEOUT_MS);
}

function summarize(value: unknown, limit = 80): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (!s) return '';
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…`;
}

function safeStringify(value: unknown): string {
  // JSON.stringify with a circular-ref-tolerant replacer.
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
      if (typeof val === 'bigint') return `${val.toString()}n`;
      if (typeof val === 'undefined') return null;
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack };
      if (val && typeof val === 'object') {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      return val;
    },
  ) ?? 'null';
}

interface RunJsDeps {
  /** mainWindow.webContents.executeJavaScript shape. */
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

/**
 * Pure-ish core of pp_run_js. Exported for unit tests. The Electron handler
 * wraps this with a real `webContents` reference.
 */
export async function runJs(
  payload: AgentRunJsPayload,
  deps: RunJsDeps,
): Promise<AgentRunJsResult> {
  const code = typeof payload?.code === 'string' ? payload.code : '';
  if (!code) {
    return { ok: false, error: 'Missing or empty `code`.' };
  }
  if (Buffer.byteLength(code, 'utf8') > RUN_JS_MAX_CODE_BYTES) {
    return {
      ok: false,
      error: `Code exceeds ${RUN_JS_MAX_CODE_BYTES} byte limit.`,
    };
  }

  const timeoutMs = clampTimeout(payload?.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    // executeJavaScript only resolves when the renderer JS resolves — wrap in
    // Promise.race against a timer.
    const evalPromise = (async () => deps.executeJavaScript(code, false))();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`pp_run_js timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const value = await Promise.race([evalPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    const stringified = safeStringify(value);
    if (Buffer.byteLength(stringified, 'utf8') > RUN_JS_MAX_RESULT_BYTES) {
      return {
        ok: false,
        error: `Result exceeds ${RUN_JS_MAX_RESULT_BYTES} byte limit. Slice or summarize in your JS before returning.`,
      };
    }
    // Parse back so the caller gets a structured value, not a JSON string.
    let parsed: unknown;
    try {
      parsed = JSON.parse(stringified);
    } catch {
      parsed = stringified;
    }
    return { ok: true, value: parsed as AgentRunJsResult extends { ok: true; value: infer V } ? V : unknown };
  } catch (error) {
    if (timer) clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

interface CapturePageWindow {
  webContents: {
    capturePage: () => Promise<{ toPNG: () => Buffer; getSize?: () => { width: number; height: number } }>;
  };
}

export async function screenshot(
  payload: AgentScreenshotPayload,
  win: CapturePageWindow,
): Promise<AgentScreenshotResult> {
  // `region` is currently informational — Electron's capturePage() always
  // grabs the whole BrowserWindow client area. We accept the parameter so the
  // contract can grow later (e.g. element bounds) without a breaking change.
  void payload?.region;
  try {
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (png.byteLength > SCREENSHOT_MAX_BYTES) {
      return {
        ok: false,
        error: `Screenshot exceeds ${SCREENSHOT_MAX_BYTES} byte limit. Resize the window or take a region in JS.`,
      };
    }
    const size = typeof image.getSize === 'function' ? image.getSize() : { width: 0, height: 0 };
    return {
      ok: true,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: size.width,
      height: size.height,
      byteLength: png.byteLength,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * The DOM-walker JS that runs in the renderer. It collects visible
 * interactive elements (anything with role/tabindex/onClick/test-id) up to
 * `maxNodes` and returns a tree.
 *
 * The function is serialized into a string and shipped over `executeJavaScript`
 * — keep it self-contained (no closures over electron-side variables, no TS).
 */
const DOM_SNAPSHOT_RENDERER_FN = `
(function (rootSelector, maxNodes) {
  var INTERACTIVE_TAGS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, LABEL: 1, OPTION: 1, SUMMARY: 1, DETAILS: 1, DIALOG: 1 };
  var root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return { error: 'Root not found: ' + rootSelector };
  var count = 0;
  var truncated = false;
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }
  function isInteractive(el) {
    if (INTERACTIVE_TAGS[el.tagName]) return true;
    if (el.hasAttribute('data-testid')) return true;
    if (el.hasAttribute('role')) return true;
    if (el.hasAttribute('tabindex')) return true;
    if (el.hasAttribute('aria-label')) return true;
    return false;
  }
  function describe(el) {
    var rect = el.getBoundingClientRect();
    var label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    var text = '';
    try {
      var raw = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      text = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
    } catch (_) {}
    return {
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid') || null,
      role: el.getAttribute('role') || null,
      label: label || null,
      text: text || null,
      type: el.getAttribute('type') || null,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      children: []
    };
  }
  function walk(el, parentNode) {
    if (count >= maxNodes) { truncated = true; return; }
    if (!(el instanceof Element)) return;
    var node = null;
    if (isVisible(el) && isInteractive(el)) {
      node = describe(el);
      parentNode.children.push(node);
      count += 1;
    }
    var childParent = node || parentNode;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (count >= maxNodes) { truncated = true; break; }
      walk(kids[i], childParent);
    }
  }
  var rootNode = { tag: root.tagName.toLowerCase(), testid: root.getAttribute('data-testid') || null, role: null, label: null, text: null, type: null, disabled: false, bounds: null, children: [] };
  for (var i = 0; i < root.children.length; i++) {
    if (count >= maxNodes) { truncated = true; break; }
    walk(root.children[i], rootNode);
  }
  return { root: rootNode, nodeCount: count, truncated: truncated };
})
`.trim();

export function buildDomSnapshotScript(rootSelector: string | undefined, maxNodes: number): string {
  const safeRoot = rootSelector ? JSON.stringify(rootSelector) : 'null';
  const safeMax = String(Math.max(1, Math.min(maxNodes, DOM_SNAPSHOT_HARD_MAX_NODES)));
  return `${DOM_SNAPSHOT_RENDERER_FN}(${safeRoot}, ${safeMax})`;
}

export async function domSnapshot(
  payload: AgentDomSnapshotPayload,
  deps: RunJsDeps,
): Promise<AgentDomSnapshotResult> {
  const requestedMax =
    typeof payload?.maxNodes === 'number' && Number.isFinite(payload.maxNodes) && payload.maxNodes > 0
      ? Math.min(Math.floor(payload.maxNodes), DOM_SNAPSHOT_HARD_MAX_NODES)
      : DOM_SNAPSHOT_DEFAULT_MAX_NODES;
  const script = buildDomSnapshotScript(payload?.rootSelector ?? undefined, requestedMax);
  try {
    const raw = (await deps.executeJavaScript(script, false)) as
      | { error?: string; root?: unknown; nodeCount?: number; truncated?: boolean }
      | undefined;
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'DOM snapshot returned empty result' };
    }
    if (typeof raw.error === 'string') {
      return { ok: false, error: raw.error };
    }
    return {
      ok: true,
      root: raw.root,
      nodeCount: typeof raw.nodeCount === 'number' ? raw.nodeCount : 0,
      truncated: Boolean(raw.truncated),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

// Logging helpers used by the live IPC handlers. Tests stub the deps directly
// so they don't touch electron-log.

export function logRunJs(code: string, result: AgentRunJsResult): void {
  if (result.ok) {
    log.info(`${LOG_TAG} run_js ok code=${code.length}b result=${summarize(result.value)}`);
  } else {
    log.warn(`${LOG_TAG} run_js err code=${code.length}b error=${result.error}`);
  }
}

export function logScreenshot(result: AgentScreenshotResult): void {
  if (result.ok) {
    log.info(`${LOG_TAG} screenshot ok ${result.width}x${result.height} ${result.byteLength}b`);
  } else {
    log.warn(`${LOG_TAG} screenshot err ${result.error}`);
  }
}

export function logDomSnapshot(result: AgentDomSnapshotResult): void {
  if (result.ok) {
    log.info(`${LOG_TAG} dom_snapshot ok nodes=${result.nodeCount} truncated=${result.truncated}`);
  } else {
    log.warn(`${LOG_TAG} dom_snapshot err ${result.error}`);
  }
}

export {
  RUN_JS_DEFAULT_TIMEOUT_MS,
  RUN_JS_MAX_TIMEOUT_MS,
  RUN_JS_MAX_CODE_BYTES,
  RUN_JS_MAX_RESULT_BYTES,
  SCREENSHOT_MAX_BYTES,
  DOM_SNAPSHOT_DEFAULT_MAX_NODES,
  DOM_SNAPSHOT_HARD_MAX_NODES,
};

// Type passthrough — declared in contracts but re-exported for callers that
// import from this module.
export type {
  AgentDomSnapshotPayload,
  AgentDomSnapshotResult,
  AgentRunJsPayload,
  AgentRunJsResult,
  AgentScreenshotPayload,
  AgentScreenshotResult,
} from '@producer-player/contracts';

/** Used by main.ts when wiring real ipcMain.handle. */
export interface AgentUiControlWindow {
  webContents: {
    executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
    capturePage: () => Promise<{ toPNG: () => Buffer; getSize?: () => { width: number; height: number } }>;
  };
}

export function makeRunJsDeps(win: BrowserWindow | AgentUiControlWindow): RunJsDeps {
  return {
    executeJavaScript: (code, userGesture) => win.webContents.executeJavaScript(code, userGesture),
  };
}
