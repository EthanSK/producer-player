#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.argv[2] ?? 'zip';
const supportedTargets = new Set(['zip', 'dir', 'mas-dev', 'mas']);
const isMasTarget = target === 'mas' || target === 'mas-dev';

if (!supportedTargets.has(target)) {
  console.error(
    `[producer-player] Unsupported macOS build target "${target}". Use one of: ${[
      ...supportedTargets,
    ].join(', ')}`
  );
  process.exit(1);
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
  });

  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      process.exit(result.status);
    }
    return;
  }

  if (result.error) {
    console.error(`[producer-player] Failed to run ${command}:`, result.error.message);
  }

  process.exit(1);
}

function runNpm(args, env) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCommand, args, env);
}

function maybeWarnAboutSigningIdentity(expectedLabel) {
  if (process.platform !== 'darwin') {
    return;
  }

  const securityResult = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
    env: process.env,
  });

  if (securityResult.status !== 0) {
    return;
  }

  const output = `${securityResult.stdout ?? ''}\n${securityResult.stderr ?? ''}`;
  const hasExpectedIdentity = output.includes(expectedLabel);
  const hasExplicitIdentity = typeof process.env.CSC_NAME === 'string' && process.env.CSC_NAME.length > 0;

  if (!hasExpectedIdentity && !hasExplicitIdentity) {
    console.warn(
      `[producer-player] Warning: no ${expectedLabel} signing identity was detected in the keychain. ` +
        `If electron-builder cannot auto-pick the right cert, set CSC_NAME explicitly before rerunning.`
    );
  }
}

const buildEnv = {
  ...process.env,
};

if (isMasTarget) {
  const provisioningProfile = process.env.PRODUCER_PLAYER_PROVISIONING_PROFILE;
  if (!provisioningProfile) {
    console.error(
      '[producer-player] Missing PRODUCER_PLAYER_PROVISIONING_PROFILE. ' +
        'Set it to the absolute path of the .provisionprofile file for this build.'
    );
    process.exit(1);
  }

  const resolvedProvisioningProfile = resolve(provisioningProfile);
  if (!existsSync(resolvedProvisioningProfile)) {
    console.error(
      `[producer-player] Provisioning profile not found: ${resolvedProvisioningProfile}`
    );
    process.exit(1);
  }

  buildEnv.PRODUCER_PLAYER_PROVISIONING_PROFILE = resolvedProvisioningProfile;
  buildEnv.PRODUCER_PLAYER_SKIP_BUNDLED_FFMPEG = 'true';
  maybeWarnAboutSigningIdentity(target === 'mas' ? 'Apple Distribution' : 'Apple Development');
} else {
  buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  buildEnv.PRODUCER_PLAYER_SKIP_BUNDLED_FFMPEG = 'false';
}

console.log(`[producer-player] Building macOS target: ${target}`);
runNpm(['run', 'build'], buildEnv);
runNpm(['exec', '--', 'electron-builder', '--mac', target, '--publish', 'never'], buildEnv);

if (isMasTarget) {
  console.log(
    `[producer-player] Completed ${target} build. This target still requires Apple signing/provisioning setup and App Store Connect submission steps.`
  );
} else {
  console.log(`[producer-player] Completed unsigned macOS ${target} build.`);
}
