const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing__, openFileWithDetachedSystemHandler } = require('../dist/file-open.test.cjs');

const { buildDetachedSystemOpenRequest } = __testing__;

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
