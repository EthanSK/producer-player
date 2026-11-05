// Exercise the publication gate with synthetic files. The September release
// had working Linux/Windows assets but no Mac payload or feed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkReleaseArtifacts } from './check-release-artifacts.mjs';

const version = '3.340.0';
const prefix = 'Producer-Player-' + version;
const platforms = [
  ['latest-mac.yml', prefix + '-mac-universal.zip'],
  ['latest-linux.yml', prefix + '-linux-x64.AppImage'],
  ['latest.yml', prefix + '-win-x64.exe'],
];

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'producer-release-guards-'));
  const directory = join(parent, 'fixtures.noindex');
  mkdirSync(directory);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  for (const [feed, artifact] of platforms) {
    const payload = Buffer.from('Synthetic release fixture for ' + artifact);
    writeFileSync(join(directory, artifact), payload);
    const digest = createHash('sha512').update(payload).digest('base64');
    writeFileSync(join(directory, feed),
      'version: ' + version + '\nfiles:\n  - url: ' + artifact +
      '\n    sha512: ' + digest + '\n    size: ' + payload.length +
      '\npath: ' + artifact + '\nsha512: ' + digest +
      '\nreleaseDate: 2026-11-05T00:00:00.000Z\n');
  }
  for (const suffix of ['deb', 'zip']) {
    writeFileSync(join(directory, prefix + '-linux-x64.' + suffix), 'Synthetic Linux fixture');
  }
  return directory;
}

test('publishes only a complete three-platform release', (t) => {
  assert.equal(checkReleaseArtifacts(fixture(t), version).length, 8);
});

test('rejects the observed Linux/Windows-only release shape', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'producer-observed-release-'));
  const directory = join(parent, 'fixtures.noindex');
  mkdirSync(directory);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const observed = JSON.parse(readFileSync(new URL('./fixtures/producer-v3.339-github-release.json', import.meta.url), 'utf8'));
  for (const asset of observed.release.assets) {
    writeFileSync(join(directory, asset.name), 'Synthetic contents; observed asset name');
  }
  assert.throws(() => checkReleaseArtifacts(directory, '3.339.0'), /incomplete latest release.*latest-mac/);
});

for (const [feed, artifact] of platforms) {
  test('rejects a missing updater feed: ' + feed, (t) => {
    const directory = fixture(t);
    rmSync(join(directory, feed));
    assert.throws(() => checkReleaseArtifacts(directory, version), /incomplete latest release/);
  });
  test('rejects an empty download: ' + artifact, (t) => {
    const directory = fixture(t);
    writeFileSync(join(directory, artifact), '');
    assert.throws(() => checkReleaseArtifacts(directory, version), /incomplete latest release/);
  });
}

test('rejects stale Mac metadata even alongside the new archive', (t) => {
  const directory = fixture(t);
  const feed = join(directory, 'latest-mac.yml');
  writeFileSync(feed, readFileSync(feed, 'utf8').replace('version: ' + version, 'version: 3.338.0'));
  assert.throws(() => checkReleaseArtifacts(directory, version), /version mismatch/);
});

test('rejects Mac metadata pointing to a different download', (t) => {
  const directory = fixture(t);
  const feed = join(directory, 'latest-mac.yml');
  writeFileSync(feed, readFileSync(feed, 'utf8').replaceAll(prefix + '-mac-universal.zip', prefix + '-mac-arm64.zip'));
  assert.throws(() => checkReleaseArtifacts(directory, version), /path mismatch/);
});
