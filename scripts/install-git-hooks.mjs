import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const hooksPath = '.githooks';
const prePushHookPath = path.join(repoRoot, hooksPath, 'pre-push');

async function git(args) {
  const { stdout } = await execFile('git', args, { cwd: repoRoot });
  return stdout.trim();
}

async function main() {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    console.log('[hooks:install] Not inside a git worktree; skipping hook install.');
    return;
  }

  try {
    await access(prePushHookPath, constants.F_OK);
  } catch {
    throw new Error(`Expected hook file at ${path.relative(repoRoot, prePushHookPath)}.`);
  }

  await git(['config', '--local', 'core.hooksPath', hooksPath]);

  const configuredHooksPath = await git(['config', '--local', '--get', 'core.hooksPath']);
  if (configuredHooksPath !== hooksPath) {
    throw new Error(
      `Failed to set core.hooksPath to ${hooksPath}. Current value: ${configuredHooksPath || '(unset)'}`
    );
  }

  console.log('[hooks:install] Configured git hooks path to .githooks');
}

main().catch((error) => {
  console.error(`[hooks:install] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
