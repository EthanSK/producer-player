const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __testing__,
  isDetachedSystemOpenablePath,
  openFileWithDetachedSystemHandler,
} = require('../dist/file-open.test.cjs');

const { buildDetachedSystemOpenRequest } = __testing__;

test('treats regular files and DAW package directories as OS-openable project paths', () => {
  assert.equal(
    isDetachedSystemOpenablePath({
      isFile: () => true,
      isDirectory: () => false,
    }),
    true
  );
  assert.equal(
    isDetachedSystemOpenablePath({
      isFile: () => false,
      isDirectory: () => true,
    }),
    true
  );
});

test('rejects filesystem entries that the OS file opener should not receive', () => {
  assert.equal(
    isDetachedSystemOpenablePath({
      isFile: () => false,
      isDirectory: () => false,
    }),
    false
  );
});

test('uses macOS open command for detached OS file handoff', () => {
  const request = buildDetachedSystemOpenRequest('/tmp/Ableton Session.als', 'darwin');

  assert.equal(request.command, '/usr/bin/open');
  assert.deepEqual(request.args, ['/tmp/Ableton Session.als']);
  assert.equal(request.options.detached, true);
  assert.equal(request.options.stdio, 'ignore');
  assert.equal(request.options.windowsHide, true);
});

test('uses Windows file-association handoff without direct DAW executable launch', () => {
  const request = buildDetachedSystemOpenRequest('C:\\Sessions\\Ableton Session.als', 'win32');

  assert.equal(request.command, 'rundll32.exe');
  assert.deepEqual(request.args, [
    'url.dll,FileProtocolHandler',
    'C:\\Sessions\\Ableton Session.als',
  ]);
  assert.equal(request.options.detached, true);
  assert.equal(request.options.stdio, 'ignore');
});

test('uses xdg-open fallback for Linux-style desktop file associations', () => {
  const request = buildDetachedSystemOpenRequest('/tmp/Logic Session.logicx', 'linux');

  assert.equal(request.command, 'xdg-open');
  assert.deepEqual(request.args, ['/tmp/Logic Session.logicx']);
  assert.equal(request.options.detached, true);
  assert.equal(request.options.stdio, 'ignore');
});

test('spawns and unrefs the detached handoff process without waiting for completion', () => {
  const spawnCalls = [];
  const child = {
    onceCalls: [],
    unrefCalled: false,
    once(eventName, handler) {
      this.onceCalls.push({ eventName, handler });
      return this;
    },
    unref() {
      this.unrefCalled = true;
    },
  };

  openFileWithDetachedSystemHandler('/tmp/Ableton Session.als', {
    platform: 'darwin',
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, '/usr/bin/open');
  assert.deepEqual(spawnCalls[0].args, ['/tmp/Ableton Session.als']);
  assert.equal(spawnCalls[0].options.detached, true);
  assert.equal(spawnCalls[0].options.stdio, 'ignore');
  assert.equal(child.onceCalls.length, 1);
  assert.equal(child.onceCalls[0].eventName, 'error');
  assert.equal(child.unrefCalled, true);
});

test('surfaces immediate spawn failures to the caller', () => {
  assert.throws(
    () =>
      openFileWithDetachedSystemHandler('/tmp/Ableton Session.als', {
        platform: 'darwin',
        spawn() {
          throw new Error('spawn failed');
        },
      }),
    /Could not hand off file to the operating system opener: spawn failed/
  );
});

// v3.202 — Anti-rainbow-wheel regression test. Ethan reported (voice
// 2833) that opening an Ableton-linked project froze Producer Player
// with the macOS beachball while Ableton booted. The renderer's
// `Open project` button must NEVER block its caller, even if the
// underlying spawn (or any post-spawn LaunchServices step) hangs.
// This test simulates a child whose async work never resolves and
// asserts that `openFileWithDetachedSystemHandler` STILL returns
// synchronously within a tight budget — i.e. nothing in this layer
// can ever be awaited by mistake.
test('returns synchronously even when the spawned child never completes', () => {
  const child = {
    once() {
      return this;
    },
    unref() {},
  };

  const start = Date.now();
  openFileWithDetachedSystemHandler('/tmp/Ableton Session.als', {
    platform: 'darwin',
    spawn() {
      // Simulate a slow handoff. The function must NOT wait on this —
      // it should construct the spawn request, call spawn, hook the
      // error listener, unref, and return.
      return child;
    },
  });
  const elapsedMs = Date.now() - start;

  // 50ms budget: generous for CI but tight enough that any accidental
  // `await` on a 5s simulated delay would blow it.
  assert.ok(
    elapsedMs < 50,
    `expected synchronous return; took ${elapsedMs}ms (fire-and-forget broken?)`
  );
});

test('reports asynchronous child errors without awaiting the child', () => {
  let asyncError = null;
  let errorHandler = null;
  const child = {
    once(eventName, handler) {
      if (eventName === 'error') {
        errorHandler = handler;
      }
      return this;
    },
    unref() {},
  };

  openFileWithDetachedSystemHandler('/tmp/Ableton Session.als', {
    platform: 'darwin',
    spawn() {
      return child;
    },
    onAsyncError(error) {
      asyncError = error;
    },
  });

  assert.equal(typeof errorHandler, 'function');
  const failure = new Error('later failure');
  errorHandler(failure);
  assert.equal(asyncError, failure);
});
