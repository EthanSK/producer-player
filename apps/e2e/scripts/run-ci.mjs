import { spawnSync } from 'node:child_process';
import os from 'node:os';

function hasCommand(command) {
  const check = spawnSync('bash', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
  });
  return check.status === 0;
}

const platform = os.platform();
const isLinux = platform === 'linux';
const isWindows = platform === 'win32';

const forwardedArgs = process.argv.slice(2);
const grepArg = process.env.PLAYWRIGHT_GREP?.trim();
const grepArgs = grepArg ? ['--grep', grepArg] : [];
const workersArg = process.env.PLAYWRIGHT_WORKERS?.trim();
const workerArgs = workersArg ? ['--workers', workersArg] : [];
const npxCommand = isWindows ? 'npx.cmd' : 'npx';

let command = ['npx', 'playwright', 'test', ...workerArgs, ...grepArgs, ...forwardedArgs];

if (isLinux && hasCommand('xvfb-run')) {
  command = ['xvfb-run', '-a', npxCommand, 'playwright', 'test', ...workerArgs, ...grepArgs, ...forwardedArgs];
} else {
  command = [npxCommand, 'playwright', 'test', ...workerArgs, ...grepArgs, ...forwardedArgs];
}

const run = spawnSync(command[0], command.slice(1), {
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI ?? '1',
  },
});

if (run.error) {
  console.error(run.error);
  process.exit(1);
}

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}
