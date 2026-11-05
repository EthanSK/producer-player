#!/usr/bin/env node
// Refuse to move GitHub's shared latest release unless every desktop platform
// has its download and updater feed. Run before publishing Release Desktop.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function checkReleaseArtifacts(directory, version) {
  if (!/^\d+\.\d+\.0$/.test(version)) {
    throw new Error('Expected the release version in x.y.0 form.');
  }
  const prefix = 'Producer-Player-' + version;
  const feeds = [
    ['latest-mac.yml', prefix + '-mac-universal.zip'],
    ['latest-linux.yml', prefix + '-linux-x64.AppImage'],
    ['latest.yml', prefix + '-win-x64.exe'],
  ];
  const required = [...feeds.flat(), prefix + '-linux-x64.deb', prefix + '-linux-x64.zip'];
  const missing = required.filter((name) => {
    try {
      const entry = statSync(resolve(directory, name));
      return !entry.isFile() || entry.size === 0;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    throw new Error('Refusing an incomplete latest release; missing or empty: ' + missing.join(', '));
  }
  // Reuse the existing feed parser. Each platform must name the exact payload
  // required above, rather than silently reusing metadata from an older build.
  const checker = fileURLToPath(new URL('./check-latest-mac-yml.mjs', import.meta.url));
  for (const [feed, artifact] of feeds) {
    const result = spawnSync(process.execPath, [checker, resolve(directory, feed)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EXPECTED_VERSION: version,
        EXPECTED_PATH_REGEX: '^' + artifact.replaceAll('.', '\\.') + '$',
      },
    });
    if (result.status !== 0) {
      throw new Error(feed + ' failed validation: ' + (result.stderr || result.error?.message || 'unknown failure'));
    }
  }
  return required;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: check-release-artifacts.mjs <release-directory>');
    const version = process.env.EXPECTED_VERSION ||
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const checked = checkReleaseArtifacts(process.argv[2], version);
    console.log('[release-artifacts] All three platforms and updater feeds verified (' + checked.length + ' files).');
  } catch (error) {
    console.error('[release-artifacts] ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
