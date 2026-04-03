import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');

const packageJsonPath = path.join(repoRoot, 'package.json');
const siteVersionPath = path.join(repoRoot, 'site', 'version.json');
const siteIndexPath = path.join(repoRoot, 'site', 'index.html');
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release-desktop.yml');
const pagesWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'pages.yml');
const ciWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

function normalizeVersion(rawVersion, sourceLabel) {
  if (typeof rawVersion !== 'string') {
    throw new Error(`${sourceLabel} version must be a string.`);
  }

  const version = rawVersion.trim().replace(/^v/i, '');
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`${sourceLabel} version "${rawVersion}" is not valid semver.`);
  }

  return version;
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const siteVersion = JSON.parse(await readFile(siteVersionPath, 'utf8'));

  const packageVersion = normalizeVersion(packageJson.version, 'package.json');
  const siteVersionValue = normalizeVersion(siteVersion.version, 'site/version.json');

  if (siteVersionValue !== packageVersion) {
    throw new Error(
      `site/version.json (${siteVersionValue}) does not match package.json (${packageVersion}). Run: npm run version:sync`
    );
  }

  if (siteVersion.source !== 'package.json') {
    throw new Error('site/version.json must declare source: "package.json".');
  }

  const siteIndex = await readFile(siteIndexPath, 'utf8');
  if (!siteIndex.includes('id="site-version-label"')) {
    throw new Error('site/index.html is missing the #site-version-label element.');
  }

  if (!siteIndex.includes("fetch('./version.json'")) {
    throw new Error('site/index.html must read version metadata from ./version.json.');
  }

  const hardcodedSiteVersionPattern =
    /<span class="logo-version"[^>]*>\s*v\d+\.\d+(?:\.\d+)?(?:-[^<\s]+)?\s*<\/span>/i;
  if (hardcodedSiteVersionPattern.test(siteIndex)) {
    throw new Error('site/index.html still contains a hardcoded semantic version label.');
  }

  const releaseWorkflow = await readFile(releaseWorkflowPath, 'utf8');
  if (!releaseWorkflow.includes("app_version=\"$(node -p \"require('./package.json').version\")\"")) {
    throw new Error('release workflow must derive app_version from package.json.');
  }

  if (/\bnpm\s+version\b/.test(releaseWorkflow)) {
    throw new Error('release workflow must not rewrite package.json version in CI.');
  }

  const pagesWorkflow = await readFile(pagesWorkflowPath, 'utf8');
  if (!pagesWorkflow.includes('npm run version:sync')) {
    throw new Error('pages workflow must sync version metadata before deploy.');
  }

  const ciWorkflow = await readFile(ciWorkflowPath, 'utf8');
  if (!ciWorkflow.includes('npm run version:check')) {
    throw new Error('CI workflow must run version consistency checks.');
  }

  console.log(`[version:check] OK — unified version source is package.json (${packageVersion}).`);
}

main().catch((error) => {
  console.error(`[version:check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
