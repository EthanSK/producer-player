import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');

const packageJsonPath = path.join(repoRoot, 'package.json');
const siteVersionPath = path.join(repoRoot, 'site', 'version.json');

function normalizeVersion(rawVersion) {
  if (typeof rawVersion !== 'string') {
    throw new Error('package.json version must be a string.');
  }

  const version = rawVersion.trim().replace(/^v/i, '');

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(
      `package.json version "${rawVersion}" is not a supported semantic version.`
    );
  }

  return version;
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const version = normalizeVersion(packageJson.version);

  const payload = {
    version,
    displayVersion: `v${version}`,
    source: 'package.json',
  };

  const nextContent = `${JSON.stringify(payload, null, 2)}\n`;

  let existingContent = null;
  try {
    existingContent = await readFile(siteVersionPath, 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (existingContent === nextContent) {
    console.log(`[version:sync] site/version.json already matches package.json (${version}).`);
    return;
  }

  await writeFile(siteVersionPath, nextContent, 'utf8');
  console.log(`[version:sync] Updated site/version.json → v${version}.`);
}

main().catch((error) => {
  console.error(`[version:sync] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
