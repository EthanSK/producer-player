/**
 * v3.200 — Unit tests for the structured action log writer.
 *
 * Covers:
 *   * `normalizeEntry` coerces malformed input into a valid entry shape
 *     and never throws.
 *   * `serializeEntry` produces one trailing-newline JSON line.
 *   * `normalizeError` flattens Error instances + plain-object inputs.
 *   * Rotation re-numbers files highest-first, drops the oldest, and
 *     respects `maxRotations`.
 *   * `ActionLogWriter.append` writes serialized lines and triggers
 *     rotation when the file size crosses the threshold.
 *
 * All tests use an in-memory `ActionLogFsHandlers` so the suite stays
 * hermetic — no temp directories, no real filesystem.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __testing__,
  initActionLog,
  ACTION_LOG_FILE_NAME,
  ACTION_LOG_MAX_BYTES,
  ACTION_LOG_MAX_ROTATIONS,
} = require('../dist/actionLog.test.cjs');

const {
  truncate,
  safeStringify,
  normalizeError,
  normalizeEntry,
  serializeEntry,
  rotateChain,
  ActionLogWriter,
} = __testing__;

// ---------------------------------------------------------------------------
// In-memory fs double
// ---------------------------------------------------------------------------

function createMemoryFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    dirs,
    handlers: {
      async appendFile(path, data) {
        files.set(path, (files.get(path) ?? '') + data);
      },
      statSize(path) {
        if (!files.has(path)) return null;
        return Buffer.byteLength(files.get(path), 'utf8');
      },
      async rename(from, to) {
        if (!files.has(from)) throw new Error(`ENOENT ${from}`);
        files.set(to, files.get(from));
        files.delete(from);
      },
      async unlink(path) {
        files.delete(path);
      },
      async mkdir(path) {
        dirs.add(path);
      },
      exists(path) {
        return files.has(path);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// truncate + safeStringify
// ---------------------------------------------------------------------------

test('truncate returns input unchanged when within bounds', () => {
  assert.equal(truncate('hello', 10), 'hello');
  assert.equal(truncate('', 10), '');
});

test('truncate adds an explicit ellipsis with overflow count', () => {
  const out = truncate('abcdefghij', 4);
  assert.match(out, /^abcd…\[truncated 6ch\]$/);
});

test('safeStringify handles circular references', () => {
  const obj = { a: 1 };
  obj.self = obj;
  const out = safeStringify(obj);
  assert.match(out, /\[Circular\]/);
});

test('safeStringify falls back gracefully on bigint', () => {
  const out = safeStringify({ n: 5n });
  assert.match(out, /5n/);
});

// ---------------------------------------------------------------------------
// normalizeError
// ---------------------------------------------------------------------------

test('normalizeError unwraps Error instances', () => {
  const err = new TypeError('bad type');
  const out = normalizeError(err);
  assert.equal(out.name, 'TypeError');
  assert.equal(out.message, 'bad type');
  assert.ok(typeof out.stack === 'string' && out.stack.includes('TypeError'));
});

test('normalizeError accepts plain-object errors', () => {
  const out = normalizeError({ name: 'CustomError', message: 'oops', stack: 'frame' });
  assert.deepEqual(out, { name: 'CustomError', message: 'oops', stack: 'frame' });
});

test('normalizeError handles primitive / null inputs', () => {
  assert.equal(normalizeError('boom').message, 'boom');
  assert.equal(normalizeError(null).message, 'unknown');
  assert.equal(normalizeError(undefined).message, 'unknown');
  assert.equal(normalizeError(42).message, '42');
});

// ---------------------------------------------------------------------------
// normalizeEntry
// ---------------------------------------------------------------------------

test('normalizeEntry fills required fields with safe defaults', () => {
  const out = normalizeEntry({});
  assert.equal(out.level, 'info');
  assert.equal(out.source, 'main');
  assert.equal(out.event, 'unknown.event');
  assert.match(out.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('normalizeEntry preserves valid fields verbatim', () => {
  const out = normalizeEntry({
    ts: '2026-05-12T10:00:00.000Z',
    level: 'warn',
    event: 'song.play',
    source: 'renderer',
    context: { songId: 's1', versionId: 'v2' },
  });
  assert.equal(out.ts, '2026-05-12T10:00:00.000Z');
  assert.equal(out.level, 'warn');
  assert.equal(out.event, 'song.play');
  assert.equal(out.source, 'renderer');
  assert.deepEqual(out.context, { songId: 's1', versionId: 'v2' });
});

test('normalizeEntry coerces unknown level/source to defaults', () => {
  const out = normalizeEntry({ level: 'critical', source: 'foo', event: 'x' });
  assert.equal(out.level, 'info');
  assert.equal(out.source, 'main');
});

test('normalizeEntry uses fallbackSource when source is invalid', () => {
  const out = normalizeEntry({ event: 'x' }, 'renderer');
  assert.equal(out.source, 'renderer');
});

test('normalizeEntry ignores non-object context (arrays, primitives)', () => {
  const out = normalizeEntry({ event: 'x', context: [1, 2, 3] });
  assert.equal(out.context, undefined);
});

test('normalizeEntry normalizes nested error payload', () => {
  const out = normalizeEntry({
    event: 'error.unhandled',
    error: new Error('whoa'),
    level: 'error',
  });
  assert.equal(out.error.name, 'Error');
  assert.equal(out.error.message, 'whoa');
  assert.ok(out.error.stack);
});

// ---------------------------------------------------------------------------
// serializeEntry
// ---------------------------------------------------------------------------

test('serializeEntry returns one JSON line ending in a newline', () => {
  const entry = {
    ts: '2026-05-12T10:00:00.000Z',
    level: 'info',
    event: 'song.play',
    source: 'renderer',
  };
  const line = serializeEntry(entry);
  assert.equal(line.endsWith('\n'), true);
  assert.equal(line.indexOf('\n'), line.length - 1);
  const parsed = JSON.parse(line.trim());
  assert.deepEqual(parsed, entry);
});

// ---------------------------------------------------------------------------
// rotateChain
// ---------------------------------------------------------------------------

test('rotateChain shifts files by one and unlinks the oldest', async () => {
  const { handlers, files } = createMemoryFs();
  files.set('/tmp/actions.jsonl', 'current');
  files.set('/tmp/actions.jsonl.1', 'one');
  files.set('/tmp/actions.jsonl.2', 'two');
  files.set('/tmp/actions.jsonl.3', 'three');

  await rotateChain('/tmp/actions.jsonl', 3, handlers);

  // Oldest .3 was renamed to nothing (because we unlinked then shifted).
  // Final state:
  //   actions.jsonl     -> gone (became .1)
  //   actions.jsonl.1   -> previous current ("current")
  //   actions.jsonl.2   -> previous .1     ("one")
  //   actions.jsonl.3   -> previous .2     ("two")
  // and previous .3 ("three") was unlinked.
  assert.equal(files.get('/tmp/actions.jsonl'), undefined);
  assert.equal(files.get('/tmp/actions.jsonl.1'), 'current');
  assert.equal(files.get('/tmp/actions.jsonl.2'), 'one');
  assert.equal(files.get('/tmp/actions.jsonl.3'), 'two');
});

test('rotateChain is a no-op when nothing exists', async () => {
  const { handlers, files } = createMemoryFs();
  await rotateChain('/tmp/actions.jsonl', 3, handlers);
  assert.equal(files.size, 0);
});

// ---------------------------------------------------------------------------
// ActionLogWriter
// ---------------------------------------------------------------------------

test('ActionLogWriter.append writes a JSON line to actions.jsonl', async () => {
  const { handlers, files } = createMemoryFs();
  const writer = new ActionLogWriter({
    directory: '/var/log',
    fsHandlers: handlers,
  });

  await writer.append({
    ts: '2026-05-12T11:00:00.000Z',
    level: 'info',
    event: 'song.play',
    source: 'renderer',
    context: { songId: 's1' },
  });
  await writer.flush();

  const written = files.get(`/var/log/${ACTION_LOG_FILE_NAME}`);
  assert.ok(written, 'expected actions.jsonl to be written');
  const parsed = JSON.parse(written.trim());
  assert.equal(parsed.event, 'song.play');
  assert.equal(parsed.context.songId, 's1');
});

test('ActionLogWriter triggers rotation at maxBytes threshold', async () => {
  const { handlers, files } = createMemoryFs();
  const writer = new ActionLogWriter({
    directory: '/var/log',
    maxBytes: 64, // small threshold to force rotation after first append
    maxRotations: 2,
    fsHandlers: handlers,
  });

  await writer.append({
    ts: '2026-05-12T11:00:00.000Z',
    level: 'info',
    event: 'rot.first',
    source: 'main',
    context: { pad: 'x'.repeat(200) },
  });
  await writer.flush();

  // After the rotation the active file should be missing and .1 should
  // hold the prior content.
  assert.equal(files.has('/var/log/actions.jsonl'), false);
  const rotated = files.get('/var/log/actions.jsonl.1');
  assert.ok(rotated && rotated.includes('rot.first'));

  await writer.append({
    ts: '2026-05-12T11:00:01.000Z',
    level: 'info',
    event: 'rot.second',
    source: 'main',
    context: { pad: 'y'.repeat(200) },
  });
  await writer.flush();

  // Second rotation: .1 -> .2, current -> .1
  assert.ok(files.get('/var/log/actions.jsonl.1').includes('rot.second'));
  assert.ok(files.get('/var/log/actions.jsonl.2').includes('rot.first'));
});

test('ActionLogWriter swallows write errors and invokes onError', async () => {
  let captured = null;
  const writer = new ActionLogWriter({
    directory: '/var/log',
    fsHandlers: {
      async appendFile() {
        throw new Error('disk full');
      },
      statSize() {
        return null;
      },
      async rename() {},
      async unlink() {},
      async mkdir() {},
      exists() {
        return false;
      },
    },
    onError(err) {
      captured = err;
    },
  });
  await writer.append({
    ts: '2026-05-12T11:00:00.000Z',
    level: 'info',
    event: 'x',
    source: 'main',
  });
  await writer.flush();
  assert.ok(captured instanceof Error);
  assert.match(captured.message, /disk full/);
});

// ---------------------------------------------------------------------------
// initActionLog singleton wiring
// ---------------------------------------------------------------------------

test('initActionLog returns a writer pointed at <directory>/actions.jsonl', () => {
  const writer = initActionLog({ directory: '/tmp/init-test' });
  assert.equal(writer.filePath, `/tmp/init-test/${ACTION_LOG_FILE_NAME}`);
  assert.ok(ACTION_LOG_MAX_BYTES >= 1024 * 1024);
  assert.ok(ACTION_LOG_MAX_ROTATIONS >= 1);
});
