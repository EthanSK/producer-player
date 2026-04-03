import { spawn } from 'node:child_process';

const ZERO_HASH_PATTERN = /^[0]+$/;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isZeroHash(value) {
  return typeof value === 'string' && ZERO_HASH_PATTERN.test(value);
}

function parseRefLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 4) {
    return null;
  }

  const [localRef, localSha, remoteRef, remoteSha] = tokens;
  return { localRef, localSha, remoteRef, remoteSha };
}

async function readRefUpdates() {
  let raw = '';

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => parseRefLine(line))
    .filter(Boolean);
}

async function runVersionBumpCheck(baseSha) {
  const env = { ...process.env };

  if (baseSha) {
    env.VERSION_BUMP_BASE = baseSha;
  } else {
    delete env.VERSION_BUMP_BASE;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'version:bump:check'], {
      stdio: 'inherit',
      env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`version:bump:check terminated by signal ${signal}.`));
        return;
      }

      reject(new Error(`version:bump:check exited with code ${code}.`));
    });
  });
}

async function main() {
  const refUpdates = await readRefUpdates();

  const refsToValidate = refUpdates.filter((ref) => !isZeroHash(ref.localSha));

  if (refsToValidate.length === 0) {
    await runVersionBumpCheck();
    return;
  }

  for (const ref of refsToValidate) {
    const baseSha = isZeroHash(ref.remoteSha) ? undefined : ref.remoteSha;
    await runVersionBumpCheck(baseSha);
  }
}

main().catch((error) => {
  console.error(
    `[pre-push] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
