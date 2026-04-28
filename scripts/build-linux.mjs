#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageJson = JSON.parse(readFileSync(join(repositoryDirectory, 'package.json'), 'utf8'));
const appVersion = packageJson.version;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryDirectory,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown status'}.`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertSingleArtifact(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(
      `[producer-player/linux] Expected exactly one ${label} artifact, got ${matches.length}. Files: ${files.join(', ') || '(none)'}`,
    );
  }
  return matches[0];
}

function validateLinuxArtifacts() {
  const releaseDirectory = join(repositoryDirectory, 'release');
  if (!existsSync(releaseDirectory)) {
    throw new Error('[producer-player/linux] release directory was not created.');
  }

  const files = readdirSync(releaseDirectory);
  const escapedVersion = escapeRegExp(appVersion);
  assertSingleArtifact(
    files,
    new RegExp(`^Producer-Player-${escapedVersion}-linux-x64\\.AppImage$`),
    'Linux AppImage',
  );
  assertSingleArtifact(
    files,
    new RegExp(`^Producer-Player-${escapedVersion}-linux-x64\\.deb$`),
    'Linux deb',
  );
  assertSingleArtifact(
    files,
    new RegExp(`^Producer-Player-${escapedVersion}-linux-x64\\.zip$`),
    'Linux zip',
  );
  assertSingleArtifact(files, /^latest-linux\.yml$/, 'latest-linux.yml update feed');

  run(process.execPath, ['scripts/check-latest-mac-yml.mjs', 'release/latest-linux.yml'], {
    env: {
      ...process.env,
      EXPECTED_VERSION: appVersion,
      EXPECTED_PATH_REGEX: `^Producer-Player-${escapedVersion}-linux-x64\\.AppImage$`,
    },
  });
}

function main() {
  if (process.platform !== 'linux' && process.env.PRODUCER_PLAYER_ALLOW_LINUX_CROSS_BUILD !== 'true') {
    console.error(
      '[producer-player/linux] Refusing to build Linux release artifacts on this host.\n' +
        `  host platform: ${process.platform}\n` +
        '  reason: ffmpeg-static installs a host-platform binary, so a macOS/Windows cross-build would ship the wrong bundled ffmpeg.\n' +
        '  run this target on the Ubuntu release runner, or set PRODUCER_PLAYER_ALLOW_LINUX_CROSS_BUILD=true only for metadata experiments that will NOT be shipped.',
    );
    process.exit(1);
  }

  run(npmCommand, ['run', 'build']);
  run(npmCommand, ['exec', '--', 'electron-builder', '--linux', '--x64', '--publish', 'never']);
  validateLinuxArtifacts();
}

try {
  main();
} catch (error) {
  console.error(`[producer-player/linux] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
