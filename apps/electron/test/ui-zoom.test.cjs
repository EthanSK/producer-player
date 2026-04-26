const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildUiZoomState,
  getNextUiZoomPreference,
  resolveAutomaticUiZoomFactor,
  sanitizeUiZoomPreference,
} = require('../dist/ui-zoom.test.cjs');

const ZOOM_OPTIONS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15];

// Width 1920 + height 1200 puts the work area clearly past the medium band
// (≤1680 × 1050), so it lands in the "large" bucket where Windows now zooms
// to 0.95 by default (v3.82.0).
const LARGE_WINDOWS = {
  platform: 'win32',
  workArea: { width: 1920, height: 1200 },
  windowBounds: { width: 1380, height: 940 },
  scaleFactor: 1,
};

const MEDIUM_WINDOWS = {
  platform: 'win32',
  workArea: { width: 1600, height: 1000 },
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

test('sanitizeUiZoomPreference accepts the new low zoom options (v3.82.0)', () => {
  // The 0.7 / 0.75 / 0.8 steps were added so very cramped Windows work areas
  // (e.g. Dell 14" laptops) can shrink the UI further than the old 0.85 floor.
  assert.equal(sanitizeUiZoomPreference(0.7), 0.7);
  assert.equal(sanitizeUiZoomPreference(0.75), 0.75);
  assert.equal(sanitizeUiZoomPreference(0.8), 0.8);
  // Values just outside the rounding tolerance still snap to the nearest step.
  assert.equal(sanitizeUiZoomPreference(0.71), 0.7);
  assert.equal(sanitizeUiZoomPreference(0.74), 0.75);
  // Below the new minimum returns null (no extrapolation past 0.7).
  assert.equal(sanitizeUiZoomPreference(0.6), null);
});

test('automatic zoom only shrinks compact Windows work areas', () => {
  assert.deepEqual(resolveAutomaticUiZoomFactor(SMALL_WINDOWS), {
    factor: 0.8,
    reason: 'windows-small-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor({
    platform: 'win32',
    workArea: { width: 1440, height: 860 },
    windowBounds: { width: 1400, height: 840 },
  }), {
    factor: 0.85,
    reason: 'windows-compact-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor(MEDIUM_WINDOWS), {
    factor: 0.9,
    reason: 'windows-medium-work-area',
  });
  assert.deepEqual(resolveAutomaticUiZoomFactor(LARGE_WINDOWS), {
    factor: 0.95,
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
    options: ZOOM_OPTIONS,
  });

  assert.deepEqual(buildUiZoomState(null, SMALL_WINDOWS), {
    factor: 0.8,
    preference: null,
    source: 'auto',
    reason: 'windows-small-work-area',
    options: ZOOM_OPTIONS,
  });
});

test('menu zoom steps clamp at supported options', () => {
  assert.equal(getNextUiZoomPreference(null, 0.9, 1), 0.95);
  assert.equal(getNextUiZoomPreference(null, 0.9, -1), 0.85);
  assert.equal(getNextUiZoomPreference(1.15, 1.15, 1), 1.15);
  // Floor is now 0.7 — stepping down from the new minimum should clamp there.
  assert.equal(getNextUiZoomPreference(0.7, 0.7, -1), 0.7);
  // From 0.85 stepping down lands on 0.8 (previously clamped at 0.85).
  assert.equal(getNextUiZoomPreference(0.85, 0.85, -1), 0.8);
});
