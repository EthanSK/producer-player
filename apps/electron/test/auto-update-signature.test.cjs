const assert = require('node:assert/strict');
const test = require('node:test');

const { shouldVerifyInstallerSignature } = require('../dist/auto-update-signature.test.cjs');

// macOS keeps validating the notarized .app via electron-updater's mac path
// — the Apple Developer ID gate is mandatory there.
test('shouldVerifyInstallerSignature: darwin runs the signature check', () => {
  assert.equal(shouldVerifyInstallerSignature('darwin'), true);
});

// Windows installer is currently unsigned (no Authenticode cert), so the
// publisher gate must be skipped — otherwise electron-updater rejects every
// download with the macOS Developer ID dump pulled from the inherited
// CSC_LINK secret. Regression coverage for the v3.83 fix.
test('shouldVerifyInstallerSignature: win32 skips the signature check', () => {
  assert.equal(shouldVerifyInstallerSignature('win32'), false);
});

// Linux (zip) has no installer to verify; check stays off.
test('shouldVerifyInstallerSignature: linux skips the signature check', () => {
  assert.equal(shouldVerifyInstallerSignature('linux'), false);
});

// Defensive — anything outside darwin must NOT trigger the gate.
test('shouldVerifyInstallerSignature: unknown platforms skip the check', () => {
  assert.equal(shouldVerifyInstallerSignature('freebsd'), false);
  assert.equal(shouldVerifyInstallerSignature('openbsd'), false);
  assert.equal(shouldVerifyInstallerSignature('aix'), false);
});
