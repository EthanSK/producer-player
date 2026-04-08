/**
 * Custom version bump script for the two-part versioning scheme (x.y).
 *
 * IMPORTANT: Producer Player uses a TWO-PART version format.
 *   - Display version: x.y (e.g. 2.60)
 *   - Internal semver:  x.y.0 (patch is ALWAYS 0)
 *   - NEVER produce x.y.z where z > 0
 *
 * package.json stores versions as x.y.0 (valid semver with patch always 0).
 * The display version is x.y (patch part stripped).
 *
 * Do NOT manually edit the version in package.json. Always use this script:
 *   node scripts/bump-version.mjs          — bump the y part (2.14 -> 2.15)
 *   node scripts/bump-version.mjs major    — bump the x part (2.14 -> 3.0)
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

const bumpType = process.argv[2] ?? 'minor';

async function main() {
  const raw = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(raw);
  const currentVersion = String(packageJson.version || '').trim();

  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Current version "${currentVersion}" is not in the expected x.y.0 format.`);
  }

  const currentPatch = Number(match[3]);
  if (currentPatch !== 0) {
    throw new Error(
      `Current version "${currentVersion}" has a non-zero patch (${currentPatch}). ` +
      `Producer Player uses two-part versioning (x.y) where the internal patch is always 0. ` +
      `Fix package.json to x.y.0 format before bumping.`
    );
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);

  if (bumpType === 'major') {
    major += 1;
    minor = 0;
  } else {
    minor += 1;
  }

  const nextVersion = `${major}.${minor}.0`;

  // Defensive: ensure we never produce a version with non-zero patch
  if (!nextVersion.endsWith('.0')) {
    throw new Error(`Bug: computed version "${nextVersion}" does not end with .0. This should never happen.`);
  }

  // Preserve formatting: replace only the version field value
  const updatedRaw = raw.replace(
    /"version"\s*:\s*"[^"]*"/,
    `"version": "${nextVersion}"`
  );

  await writeFile(packageJsonPath, updatedRaw, 'utf8');
  console.log(`[version:bump] ${currentVersion} -> ${nextVersion} (display: ${major}.${minor})`);
}

main().catch((error) => {
  console.error(`[version:bump] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
