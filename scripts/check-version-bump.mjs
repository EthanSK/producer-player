import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const IGNORE_PREFIXES = [
  '.github/',
  'docs/',
  'references/',
];

const IGNORE_EXACT = new Set([
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'PLAN.md',
  '.gitignore',
  'site/version.json',
  'scripts/check-version-consistency.mjs',
  'scripts/check-version-bump.mjs',
  'scripts/sync-version.mjs',
  'scripts/install-git-hooks.mjs',
  'scripts/run-pre-push-version-check.mjs',
]);

function isAllZeroHash(value) {
  return /^[0]+$/.test(value);
}

function shouldIgnoreFile(filePath) {
  if (IGNORE_EXACT.has(filePath)) {
    return true;
  }

  return IGNORE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

/**
 * Convert an x.y.0 semver to two-part display format x.y.
 * If the patch is non-zero, the full semver is returned as-is.
 */
function toDisplayVersion(semver) {
  const match = semver.match(/^(\d+)\.(\d+)\.0$/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return semver;
}

function parseSemver(version, label) {
  const match = String(version).trim().match(SEMVER_PATTERN);

  if (!match) {
    throw new Error(`${label} "${version}" is not valid semantic versioning.`);
  }

  return {
    raw: String(version).trim(),
    display: toDisplayVersion(String(version).trim()),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverCore(left, right) {
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }

  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }

  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }

  return 0;
}

function formatReleaseRelevantFiles(files) {
  return files.map((filePath) => `  - ${filePath}`).join('\n');
}

async function git(args) {
  const { stdout } = await execFile('git', args, { cwd: repoRoot });
  return stdout.trim();
}

async function readPackageVersionFromRef(ref) {
  const raw = await git(['show', `${ref}:package.json`]);
  const parsed = JSON.parse(raw);
  if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
    throw new Error(`package.json at ${ref} is missing a usable version.`);
  }
  return parsed.version.trim();
}

async function resolveBaseCommit() {
  const requestedBase = process.env.VERSION_BUMP_BASE?.trim();

  if (requestedBase) {
    if (isAllZeroHash(requestedBase)) {
      return null;
    }

    try {
      return await git(['merge-base', 'HEAD', requestedBase]);
    } catch {
      return await git(['rev-parse', requestedBase]);
    }
  }

  try {
    return await git(['rev-parse', 'HEAD^']);
  } catch {
    return null;
  }
}

async function main() {
  const baseCommit = await resolveBaseCommit();

  if (!baseCommit) {
    console.log('[version:bump:check] No usable base commit found; skipping bump enforcement.');
    return;
  }

  const changedFilesRaw = await git(['diff', '--name-only', `${baseCommit}..HEAD`]);
  const changedFiles = changedFilesRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    console.log('[version:bump:check] No changed files detected; skipping bump enforcement.');
    return;
  }

  const releaseRelevantFiles = changedFiles.filter((filePath) => !shouldIgnoreFile(filePath));

  if (releaseRelevantFiles.length === 0) {
    console.log('[version:bump:check] Only non-shipping files changed; version bump not required.');
    return;
  }

  const currentPackageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const currentVersion = String(currentPackageJson.version || '').trim();
  const baseVersion = await readPackageVersionFromRef(baseCommit);

  const formattedFiles = formatReleaseRelevantFiles(releaseRelevantFiles);

  if (currentVersion === baseVersion) {
    throw new Error(
      `Release-relevant files changed without a package.json version bump.\n\n` +
        `Base version: ${baseVersion}\nCurrent version: ${currentVersion}\n\n` +
        `Changed files requiring a bump:\n${formattedFiles}\n\n` +
        `Run one of:\n` +
        `  npm run version:bump:patch   (bump the minor part, e.g. 2.14 -> 2.15)\n` +
        `  npm run version:bump:minor   (bump the major part, e.g. 2.14 -> 3.0)\n` +
        `Then commit the versioned change.`
    );
  }

  const baseSemver = parseSemver(baseVersion, 'Base package.json version');
  const currentSemver = parseSemver(currentVersion, 'Current package.json version');
  const coreComparison = compareSemverCore(currentSemver, baseSemver);

  if (coreComparison <= 0) {
    const minimumNextVersion = `${baseSemver.major}.${baseSemver.minor + 1}.0`;

    throw new Error(
      `Release-relevant files changed, but package.json did not advance by at least a version bump.\n\n` +
        `Base version: ${baseSemver.display}\nCurrent version: ${currentSemver.display}\n` +
        `Minimum required version: ${toDisplayVersion(minimumNextVersion)} (or any higher major version)\n\n` +
        `Changed files requiring a bump:\n${formattedFiles}\n\n` +
        `Run one of:\n` +
        `  npm run version:bump:patch   (bump the minor part, e.g. 2.14 -> 2.15)\n` +
        `  npm run version:bump:minor   (bump the major part, e.g. 2.14 -> 3.0)\n` +
        `Then commit the versioned change.`
    );
  }

  // Enforce two-part versioning: patch must always be 0
  if (currentSemver.patch !== 0) {
    throw new Error(
      `package.json version "${currentSemver.raw}" has a non-zero patch (${currentSemver.patch}). ` +
      `Producer Player uses two-part versioning (x.y display / x.y.0 internal). ` +
      `The patch component must always be 0. ` +
      `Fix package.json and use "npm run version:bump:patch" or "npm run version:bump:minor" to bump.`
    );
  }

  console.log(
    `[version:bump:check] OK — package.json version increased from ${baseSemver.display} to ${currentSemver.display}.`
  );
}

main().catch((error) => {
  console.error(`[version:bump:check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
