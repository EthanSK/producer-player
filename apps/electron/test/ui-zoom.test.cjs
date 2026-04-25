const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildUiZoomState,
  getNextUiZoomPreference,
  resolveAutomaticUiZoomFactor,
  sanitizeUiZoomPreference,
} = require('../dist/ui-zoom.test.cjs');

const LARGE_WINDOWS = {
  platform: 'win32',
  workArea: { width: 1920, height: 1040 },
  windowBounds: { width: 1380, height: 940 },
  scaleFactor: 1,
};

const SMALL_WINDOWS = {
  platform: 'win32',
  workArea: { width: 1280, height: 720 },
  windowBounds: { width: 1248, height: 688 },
  scaleFactor: 1.5,
};

test('sanitizeUiZoomPreference accepts only supported zoom options or auto', () => {
  assert.equal(sanitizeUiZoomPreference(null), null);
  assert.equal(sanitizeUiZoomPreference(undefined), null);
  assert.equal(sanitizeUiZoomPreference(0.9), 0.9);
  assert.equal(sanitizeUiZoomPreference(0.91), 0.9);
  assert.equal(sanitizeUiZoomPreference(1.14), 1.15);
  assert.equal(sanitizeUiZoomPreference(0.5), null);
  assert.equal(sanitizeUiZoomPreference('0.9'), null);
});

test('automatic zoom only shrinks compact Windows work areas', () => {
  assert.deepEqual(resolveAutomaticUiZoomFactor(SMALL_WINDOWS), {
    factor: 0.9,
    reason: 'windows-small-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor({
    platform: 'win32',
    workArea: { width: 1440, height: 860 },
    windowBounds: { width: 1400, height: 840 },
  }), {
    factor: 0.95,
    reason: 'windows-compact-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor(LARGE_WINDOWS), {
    factor: 1,
    reason: 'windows-large-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor({
    ...SMALL_WINDOWS,
    platform: 'darwin',
  }), {
    factor: 1,
    reason: 'default-non-windows',
  });
});

test('explicit zoom preference overrides automatic Windows default', () => {
  assert.deepEqual(buildUiZoomState(1, SMALL_WINDOWS), {
    factor: 1,
    preference: 1,
    source: 'user',
    reason: 'user-preference',
    options: [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15],
  });

  assert.deepEqual(buildUiZoomState(null, SMALL_WINDOWS), {
    factor: 0.9,
    preference: null,
    source: 'auto',
    reason: 'windows-small-work-area',
    options: [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15],
  });
});

test('menu zoom steps clamp at supported options', () => {
  assert.equal(getNextUiZoomPreference(null, 0.9, 1), 0.95);
  assert.equal(getNextUiZoomPreference(null, 0.9, -1), 0.85);
  assert.equal(getNextUiZoomPreference(1.15, 1.15, 1), 1.15);
  assert.equal(getNextUiZoomPreference(0.85, 0.85, -1), 0.85);
});
