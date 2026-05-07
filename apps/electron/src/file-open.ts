import { spawn as spawnChildProcess } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type SupportedFileOpenPlatform = NodeJS.Platform;

type SpawnFileOpenProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => Pick<ChildProcess, 'once' | 'unref'>;

interface FileOpenDeps {
  platform?: SupportedFileOpenPlatform;
  spawn?: SpawnFileOpenProcess;
  onAsyncError?: (error: unknown) => void;
}

export interface DetachedSystemOpenRequest {
  command: string;
  args: string[];
  options: SpawnOptions & {
    detached: true;
    stdio: 'ignore';
    windowsHide: true;
  };
}

export function buildDetachedSystemOpenRequest(
  filePath: string,
  platform: SupportedFileOpenPlatform = process.platform
): DetachedSystemOpenRequest {
  const options = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  } as const;

  if (platform === 'darwin') {
    return {
      command: '/usr/bin/open',
      args: [filePath],
      options,
    };
  }

  if (platform === 'win32') {
    return {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', filePath],
      options,
    };
  }

  return {
    command: 'xdg-open',
    args: [filePath],
    options,
  };
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Hands a file to the operating system's file-association opener without
 * letting the target app (Ableton/Logic/etc.) keep Producer Player's main
 * process waiting. This intentionally does not launch any DAW executable
 * directly; it only isolates the OS file-open handoff in a detached process.
 */
export function openFileWithDetachedSystemHandler(filePath: string, deps: FileOpenDeps = {}): void {
  const request = buildDetachedSystemOpenRequest(filePath, deps.platform);
  const spawnProcess = deps.spawn ?? spawnChildProcess;

  let child: Pick<ChildProcess, 'once' | 'unref'>;
  try {
    child = spawnProcess(request.command, request.args, request.options);
  } catch (cause) {
    throw new Error(
      `Could not hand off file to the operating system opener: ${toErrorMessage(cause)}`
    );
  }

  child.once('error', (cause) => {
    deps.onAsyncError?.(cause);
  });
  child.unref();
}

export const __testing__ = {
  buildDetachedSystemOpenRequest,
};
