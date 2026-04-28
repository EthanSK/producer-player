const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getStableDownloadAssetName,
  getReleaseAssetNameCandidates,
  getStableDownloadUrl,
  resolveReleaseDownloadUrl,
} = require('../dist/release-assets.test.cjs');

test('Linux x64 stable download targets the self-updating AppImage', () => {
  assert.equal(
    getStableDownloadAssetName('linux', 'x64'),
    'Producer-Player-latest-linux-x64.AppImage',
  );
  assert.equal(
    getStableDownloadUrl('linux', 'x64'),
    'https://github.com/EthanSK/producer-player/releases/latest/download/Producer-Player-latest-linux-x64.AppImage',
  );
});

test('Linux release candidates keep AppImage before deb and zip fallbacks', () => {
  assert.deepEqual(getReleaseAssetNameCandidates('linux', 'x64'), [
    'Producer-Player-latest-linux-x64.AppImage',
    'Producer-Player-latest-linux-x64.deb',
    'Producer-Player-latest-linux-x64.zip',
  ]);
});

test('Linux download resolution prefers AppImage even when portable zip exists', () => {
  const release = {
    assets: [
      {
        name: 'Producer-Player-latest-linux-x64.zip',
        browserDownloadUrl: 'https://example.invalid/linux.zip',
      },
      {
        name: 'Producer-Player-latest-linux-x64.AppImage',
        browserDownloadUrl: 'https://example.invalid/linux.AppImage',
      },
    ],
  };

  assert.equal(
    resolveReleaseDownloadUrl(release, 'linux', 'x64'),
    'https://example.invalid/linux.AppImage',
  );
});

test('Linux download resolution falls back to versioned AppImage before deb/zip', () => {
  const release = {
    assets: [
      {
        name: 'Producer-Player-3.92.0-linux-x64.zip',
        browserDownloadUrl: 'https://example.invalid/versioned.zip',
      },
      {
        name: 'Producer-Player-3.92.0-linux-x64.deb',
        browserDownloadUrl: 'https://example.invalid/versioned.deb',
      },
      {
        name: 'Producer-Player-3.92.0-linux-x64.AppImage',
        browserDownloadUrl: 'https://example.invalid/versioned.AppImage',
      },
    ],
  };

  assert.equal(
    resolveReleaseDownloadUrl(release, 'linux', 'x64'),
    'https://example.invalid/versioned.AppImage',
  );
});

test('unsupported Linux architectures do not claim a stable release asset', () => {
  assert.equal(getStableDownloadAssetName('linux', 'arm64'), null);
  assert.equal(getStableDownloadUrl('linux', 'arm64'), null);
  assert.deepEqual(getReleaseAssetNameCandidates('linux', 'arm64'), []);
});

test('macOS and Windows stable names remain unchanged', () => {
  assert.equal(
    getStableDownloadAssetName('darwin', 'arm64'),
    'Producer-Player-latest-mac-universal.zip',
  );
  assert.equal(
    getStableDownloadAssetName('win32', 'x64'),
    'Producer-Player-latest-win-x64.exe',
  );
});
