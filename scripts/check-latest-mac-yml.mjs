#!/usr/bin/env node
/**
 * Sanity-check a published `latest-mac.yml` (or any `latest*.yml` emitted by
 * electron-builder) so a regression in the publish step can't ship stale or
 * malformed update metadata. Catches:
 *
 *   - missing `version` / `path` / `sha512` / `releaseDate` / `files[0]`
 *   - `path` not matching `files[0].url`
 *   - `version` not matching the repo `package.json` version (when that
 *     env-pinning is enabled via `EXPECTED_VERSION`)
 *
 * Usage (CI):
 *   node scripts/check-latest-mac-yml.mjs path/to/latest-mac.yml
 *
 * Exit codes:
 *   0 — all required fields present, consistent
 *   1 — at least one problem (logged to stderr, loud enough for CI)
 *
 * The script is intentionally dependency-free (no `js-yaml`) so it works in
 * any Node environment without a `npm install` first. electron-builder's
 * yml output is deterministic enough that a line-oriented parse is reliable.
 */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const REQUIRED_TOP_LEVEL_KEYS = ['version', 'path', 'sha512', 'releaseDate'];

function parseSimpleYaml(source) {
  // Handles the subset electron-builder produces: top-level scalars +
  // `files:` array of `- url: ...` / `sha512: ...` / `size: ...` maps.
  const lines = source.split(/\r?\n/);
  const top = {};
  const files = [];
  let inFiles = false;
  let currentFile = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    if (raw.startsWith('files:')) {
      inFiles = true;
      continue;
    }

    if (inFiles) {
      // Dash-prefixed lines start a new file entry.
      if (/^\s*-\s/.test(raw)) {
        if (currentFile) files.push(currentFile);
        currentFile = {};
        const afterDash = raw.replace(/^\s*-\s/, '');
        const firstKv = afterDash.match(/^([^:]+):\s*(.*)$/);
        if (firstKv) currentFile[firstKv[1].trim()] = firstKv[2].trim();
        continue;
      }

      if (/^\s+\S/.test(raw) && currentFile) {
        const kv = raw.match(/^\s+([^:]+):\s*(.*)$/);
        if (kv) {
          currentFile[kv[1].trim()] = kv[2].trim();
          continue;
        }
      }

      // Non-indented line — exit files block and fall through to top-level.
      if (currentFile) files.push(currentFile);
      currentFile = null;
      inFiles = false;
    }

    const topKv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (topKv) top[topKv[1].trim()] = topKv[2].replace(/^['"]|['"]$/g, '').trim();
  }

  if (currentFile) files.push(currentFile);

  return { top, files };
}

function main() {
  const inputPath = argv[2];
  if (!inputPath) {
    console.error('Usage: check-latest-mac-yml.mjs <path-to-latest-*.yml>');
    exit(2);
  }

  let source;
  try {
    source = readFileSync(inputPath, 'utf8');
  } catch (error) {
    console.error(`[latest-yml-check] failed to read ${inputPath}:`, error.message);
    exit(1);
  }

  const { top, files } = parseSimpleYaml(source);
  const problems = [];

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!top[key]) {
      problems.push(`missing top-level key "${key}"`);
    }
  }

  if (files.length === 0) {
    problems.push('no entries under `files:` — electron-updater needs at least one');
  } else {
    const first = files[0];
    for (const key of ['url', 'sha512', 'size']) {
      if (!first[key]) {
        problems.push(`missing \`files[0].${key}\``);
      }
    }
    if (top.path && first.url && top.path !== first.url) {
      problems.push(
        `top-level \`path\` (${top.path}) doesn't match \`files[0].url\` (${first.url})`,
      );
    }
    if (top.sha512 && first.sha512 && top.sha512 !== first.sha512) {
      problems.push(`top-level \`sha512\` doesn't match \`files[0].sha512\``);
    }
  }

  const expectedVersion = process.env.EXPECTED_VERSION;
  if (expectedVersion && top.version && top.version !== expectedVersion) {
    problems.push(
      `version mismatch: yml says "${top.version}", EXPECTED_VERSION says "${expectedVersion}"`,
    );
  }

  if (problems.length > 0) {
    console.error(`[latest-yml-check] ${inputPath} FAILED:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nParsed:\n${JSON.stringify({ top, files }, null, 2)}`);
    exit(1);
  }

  console.log(
    `[latest-yml-check] ${inputPath} OK — version=${top.version} sha512=${(top.sha512 || '').slice(0, 16)}… size=${files[0]?.size ?? '?'}`,
  );
  exit(0);
}

main();
