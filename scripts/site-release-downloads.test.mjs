// Execute the actual website script against observed GitHub release shapes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/release-downloads.js', import.meta.url), 'utf8');
const complete = JSON.parse(readFileSync(new URL('./fixtures/producer-v3.338-github-release.json', import.meta.url), 'utf8'));
const partial = JSON.parse(readFileSync(new URL('./fixtures/producer-v3.339-github-release.json', import.meta.url), 'utf8')).release;
const ids = ['site-version-label', 'hero-download-primary', 'hero-download-win', 'hero-download-linux'];

async function render(payload, options = {}) {
  const elements = Object.fromEntries(ids.map((id) => [id, {
    textContent: 'v—', href: 'stable-alias',
    setAttribute(name, value) { this[name] = value; },
  }]));
  let requests = 0;
  await vm.runInNewContext(source, {
    document: { getElementById: (id) => elements[id] },
    fetch: async (url) => {
      requests += 1;
      assert.equal(url, 'https://api.github.com/repos/EthanSK/producer-player/releases/latest');
      if (options.networkFailure) throw new Error('offline');
      return { ok: !options.httpFailure, json: async () => payload };
    },
  });
  assert.equal(requests, 1);
  return elements;
}

function unchanged(elements) {
  assert.equal(elements['site-version-label'].textContent, 'v—');
  for (const id of ids.slice(1)) assert.equal(elements[id].href, 'stable-alias');
}

test('uses the actual published version and its versioned assets despite newer source metadata', async () => {
  const elements = await render(complete);
  assert.equal(elements['site-version-label'].textContent, 'v3.338');
  assert.equal(elements['hero-download-primary'].href,
    'https://github.com/EthanSK/producer-player/releases/download/v3.338/Producer-Player-3.338.0-mac-universal.zip');
  assert.match(elements['hero-download-win'].href, /v3\.338\/Producer-Player-3\.338\.0-win-x64\.exe$/);
  assert.match(elements['hero-download-linux'].href, /v3\.338\/Producer-Player-3\.338\.0-linux-x64\.AppImage$/);
});

test('keeps stable aliases for the observed incomplete v3.339 release', async () => unchanged(await render(partial)));
test('keeps stable aliases while offline', async () => unchanged(await render(null, { networkFailure: true })));
test('keeps stable aliases for GitHub rate limits', async () => unchanged(await render(null, { httpFailure: true })));
test('rejects an asset URL outside the exact published release', async () => {
  const release = structuredClone(complete);
  release.assets.find((asset) => asset.name === 'Producer-Player-3.338.0-mac-universal.zip').browser_download_url = 'https://example.com/wrong.zip';
  unchanged(await render(release));
});
test('does not expose drafts or prereleases as stable downloads', async () => {
  unchanged(await render({ ...complete, draft: true }));
  unchanged(await render({ ...complete, prerelease: true }));
});
test('keeps the published build tag and downloads its matching app version', async () => {
  const release = structuredClone(complete);
  release.tag_name = 'v3.338-build.42';
  for (const asset of release.assets) asset.browser_download_url = asset.browser_download_url.replace('/v3.338/', '/v3.338-build.42/');
  const elements = await render(release);
  assert.equal(elements['site-version-label'].textContent, release.tag_name);
  assert.match(elements['hero-download-primary'].href, /\/v3\.338-build\.42\//);
});
