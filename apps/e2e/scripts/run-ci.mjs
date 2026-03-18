import { spawnSync } from 'node:child_process';
import os from 'node:os';

function hasCommand(command) {
  const check = spawnSync('bash', ['-lc', `command -v ${command}`], {
    stdio: 'ignore',
  });
  return check.status === 0;
}

const isLinux = os.platform() === 'linux';

const forwardedArgs = process.argv.slice(2);
let command = ['npx', 'playwright', 'test', ...forwardedArgs];

if (isLinux && hasCommand('xvfb-run')) {
  command = ['xvfb-run', '-a', ...command];
}

const run = spawnSync(command[0], command.slice(1), {
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI ?? '1',
  },
});

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}
