const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDowngradeFeedUrl,
  compareDowngradeVersions,
  parseGithubReleaseListPayload,
  parseDowngradeReleaseVersion,
  resolvePreviousDowngradeRelease,
  resolveTargetRelease,
} = require('../dist/auto-update-downgrade.test.cjs');

function release(tagName, assets, overrides = {}) {
  return {
    tagName,
    htmlUrl: 'https://github.com/EthanSK/producer-player/releases/tag/' + tagName,
    name: tagName,
    publishedAt: '2026-05-25T12:00:00.000Z',
    draft: false,
    prerelease: false,
    assets,
    ...overrides,
  };
}

function macAssets(version) {
  return [
    {
      name: 'latest-mac.yml',
      browserDownloadUrl: 'https://example.invalid/' + version + '/latest-mac.yml',
    },
    {
      name: 'Producer-Player-' + version + '-mac-universal.zip',
      browserDownloadUrl: 'https://example.invalid/' + version + '/mac.zip',
    },
  ];
}

test('resolves the nearest older stable release with compatible updater metadata', () => {
  const result = resolvePreviousDowngradeRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: null,
      displayVersion: '3.265',
    },
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.265.0', macAssets('3.265.0')),
      release('v3.264.0', macAssets('3.264.0')),
      release('v3.263.0', macAssets('3.263.0')),
    ],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.release.tagName, 'v3.264.0');
  assert.equal(result.displayVersion, '3.264');
  assert.equal(result.metadataAssetName, 'latest-mac.yml');
  assert.equal(
    result.feedUrl,
    'https://github.com/EthanSK/producer-player/releases/download/v3.264.0/',
  );
});

test('does not resolve a downgrade when the installed version is already oldest', () => {
  const result = resolvePreviousDowngradeRelease({
    currentVersion: {
      semanticVersion: '3.100.0',
      buildNumber: null,
      displayVersion: '3.100',
    },
    platform: 'darwin',
    arch: 'arm64',
    releases: [release('v3.100.0', macAssets('3.100.0'))],
  });

  assert.equal(result.status, 'no-previous-version');
  assert.match(result.message, /No older Producer Player release/);
});

test('does not treat the same semantic release as previous just because the installed app has CI build metadata', () => {
  const result = resolvePreviousDowngradeRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: 834,
      displayVersion: '3.265',
    },
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.265.0', macAssets('3.265.0')),
      release('v3.264.0', macAssets('3.264.0')),
    ],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.release.tagName, 'v3.264.0');
});

test('skips prerelease, draft, and release entries missing safe platform assets', () => {
  const result = resolvePreviousDowngradeRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: null,
      displayVersion: '3.265',
    },
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.264.0', macAssets('3.264.0'), { prerelease: true }),
      release('v3.263.0', macAssets('3.263.0'), { draft: true }),
      release('v3.262.0', [
        {
          name: 'Producer-Player-3.262.0-mac-universal.zip',
          browserDownloadUrl: 'https://example.invalid/3.262.0/mac.zip',
        },
      ]),
      release('v3.261.0', macAssets('3.261.0')),
    ],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.release.tagName, 'v3.261.0');
});

test('compares build-number releases below the same semantic version', () => {
  assert.equal(
    Math.sign(
      compareDowngradeVersions(
        parseDowngradeReleaseVersion('v3.265.0-build.41'),
        parseDowngradeReleaseVersion('v3.265.0-build.42'),
      ),
    ),
    -1,
  );
});

test('parses GitHub release-list JSON into downgrade candidates', () => {
  const parsed = parseGithubReleaseListPayload([
    {
      tag_name: 'v3.264.0',
      html_url: 'https://github.com/EthanSK/producer-player/releases/tag/v3.264.0',
      name: 'v3.264.0',
      published_at: '2026-05-25T12:00:00.000Z',
      draft: false,
      prerelease: false,
      assets: [
        {
          name: 'latest-mac.yml',
          browser_download_url: 'https://example.invalid/latest-mac.yml',
        },
      ],
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].tagName, 'v3.264.0');
  assert.equal(parsed[0].assets[0].browserDownloadUrl, 'https://example.invalid/latest-mac.yml');
});

test('builds a targeted generic updater feed URL for the selected release tag', () => {
  assert.equal(
    buildDowngradeFeedUrl('v3.264.0'),
    'https://github.com/EthanSK/producer-player/releases/download/v3.264.0/',
  );
});

test('resolves an exact stable target version as a downgrade', () => {
  const result = resolveTargetRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: null,
      displayVersion: '3.265',
    },
    requestedVersion: '3.264',
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.265.0', macAssets('3.265.0')),
      release('v3.264.0', macAssets('3.264.0')),
    ],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.direction, 'downgrade');
  assert.equal(result.release.tagName, 'v3.264.0');
  assert.equal(result.displayVersion, '3.264');
});

test('resolves an exact stable target version as an upgrade', () => {
  const result = resolveTargetRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: null,
      displayVersion: '3.265',
    },
    requestedVersion: 'v3.266.0',
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.266.0', macAssets('3.266.0')),
      release('v3.265.0', macAssets('3.265.0')),
    ],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.direction, 'upgrade');
  assert.equal(result.release.tagName, 'v3.266.0');
});

test('does not resolve the currently installed version as an install target', () => {
  const result = resolveTargetRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: 100,
      displayVersion: '3.265',
    },
    requestedVersion: 'v3.265.0',
    platform: 'darwin',
    arch: 'arm64',
    releases: [release('v3.265.0', macAssets('3.265.0'))],
  });

  assert.equal(result.status, 'no-target-version');
  assert.match(result.message, /already on/);
});

test('targeted version installs skip draft/prerelease and missing metadata releases', () => {
  const result = resolveTargetRelease({
    currentVersion: {
      semanticVersion: '3.265.0',
      buildNumber: null,
      displayVersion: '3.265',
    },
    requestedVersion: '3.264',
    platform: 'darwin',
    arch: 'arm64',
    releases: [
      release('v3.264.0', macAssets('3.264.0'), { prerelease: true }),
      release('v3.264.0', macAssets('3.264.0'), { draft: true }),
      release('v3.264.0', [
        {
          name: 'Producer-Player-3.264.0-mac-universal.zip',
          browserDownloadUrl: 'https://example.invalid/3.264.0/mac.zip',
        },
      ]),
    ],
  });

  assert.equal(result.status, 'no-target-version');
});
