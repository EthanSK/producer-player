const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDefaultUserState,
  parseUserState,
} = require('../dist/state-service.test.cjs');

test('user state defaults UI zoom to automatic', () => {
  assert.equal(createDefaultUserState().uiZoomFactor, null);
  assert.equal(parseUserState({ schemaVersion: 1 }).uiZoomFactor, null);
});

test('user state persists only supported explicit UI zoom factors', () => {
  assert.equal(parseUserState({ schemaVersion: 1, uiZoomFactor: 0.9 }).uiZoomFactor, 0.9);
  assert.equal(parseUserState({ schemaVersion: 1, uiZoomFactor: 0.94 }).uiZoomFactor, 0.95);
  assert.equal(parseUserState({ schemaVersion: 1, uiZoomFactor: 1.2 }).uiZoomFactor, null);
  assert.equal(parseUserState({ schemaVersion: 1, uiZoomFactor: '0.9' }).uiZoomFactor, null);
});

test('user state clamps playback volume to the supported 0..1 range', () => {
  assert.equal(createDefaultUserState().playbackVolume, 1);
  assert.equal(parseUserState({ schemaVersion: 1 }).playbackVolume, 1);
  assert.equal(parseUserState({ schemaVersion: 1, playbackVolume: 0.25 }).playbackVolume, 0.25);
  assert.equal(parseUserState({ schemaVersion: 1, playbackVolume: -0.2 }).playbackVolume, 0);
  assert.equal(parseUserState({ schemaVersion: 1, playbackVolume: 2 }).playbackVolume, 1);
  assert.equal(parseUserState({ schemaVersion: 1, playbackVolume: '0.5' }).playbackVolume, 1);
});
