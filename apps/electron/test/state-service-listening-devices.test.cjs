/**
 * v3.193 — listening-device persistence tests.
 *
 * Verifies that the optional system-audio-output association fields
 * (`systemDeviceId`, `systemDeviceLabel`) on `ListeningDevice` round-trip
 * cleanly through `parseUserState`, are absent on devices that don't have
 * them, and that malformed values are coerced/dropped.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const { parseUserState } = require('../dist/state-service.test.cjs');

function parseDevices(raw) {
  return parseUserState({ listeningDevices: raw }).listeningDevices;
}

test('parseListeningDevices preserves systemDeviceId + systemDeviceLabel on round-trip', () => {
  const devices = parseDevices([
    {
      id: 'device-airpods',
      name: 'AirPods Pro',
      systemDeviceId: 'group-airpods-uuid',
      systemDeviceLabel: 'AirPods Pro',
    },
  ]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, 'device-airpods');
  assert.equal(devices[0].name, 'AirPods Pro');
  assert.equal(devices[0].systemDeviceId, 'group-airpods-uuid');
  assert.equal(devices[0].systemDeviceLabel, 'AirPods Pro');
});

test('parseListeningDevices omits systemDeviceId/Label when missing (historical entries)', () => {
  const devices = parseDevices([
    { id: 'device-legacy', name: 'Old listening device' },
  ]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, 'device-legacy');
  assert.equal(devices[0].name, 'Old listening device');
  assert.equal('systemDeviceId' in devices[0], false);
  assert.equal('systemDeviceLabel' in devices[0], false);
});

test('parseListeningDevices drops empty / whitespace systemDeviceId+Label values', () => {
  const devices = parseDevices([
    {
      id: 'device-mixed',
      name: 'Mixed',
      systemDeviceId: '   ',
      systemDeviceLabel: '',
    },
  ]);
  assert.equal(devices.length, 1);
  assert.equal('systemDeviceId' in devices[0], false);
  assert.equal('systemDeviceLabel' in devices[0], false);
});

test('parseListeningDevices coerces non-string systemDeviceId/Label to absent', () => {
  const devices = parseDevices([
    {
      id: 'device-bogus',
      name: 'Bogus',
      systemDeviceId: 42,
      systemDeviceLabel: { nested: 'object' },
    },
  ]);
  assert.equal(devices.length, 1);
  assert.equal('systemDeviceId' in devices[0], false);
  assert.equal('systemDeviceLabel' in devices[0], false);
});

test('parseListeningDevices still de-dupes by id when new fields are present', () => {
  const devices = parseDevices([
    {
      id: 'device-dupe',
      name: 'First',
      systemDeviceId: 'group-a',
    },
    {
      id: 'device-dupe',
      name: 'Second',
      systemDeviceId: 'group-b',
      systemDeviceLabel: 'Different',
    },
  ]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'First');
  assert.equal(devices[0].systemDeviceId, 'group-a');
});

test('parseListeningDevices keeps id-only association when label is absent', () => {
  const devices = parseDevices([
    {
      id: 'device-no-label',
      name: 'No label',
      systemDeviceId: 'group-only',
    },
  ]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].systemDeviceId, 'group-only');
  assert.equal('systemDeviceLabel' in devices[0], false);
});
