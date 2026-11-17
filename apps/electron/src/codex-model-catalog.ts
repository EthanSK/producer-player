// Discover the models accepted by the same Codex CLI that runs Producer Player's agent.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentModelDefinition } from '@producer-player/contracts';

const pendingByPath = new Map<string, Promise<AgentModelDefinition[]>>();

export async function listCodexModels(cliPath: string): Promise<AgentModelDefinition[]> {
  const pending = pendingByPath.get(cliPath);
  if (pending) return pending;
  const lookup = discoverCodexModels(cliPath);
  pendingByPath.set(cliPath, lookup);
  try {
    return await lookup;
  } finally {
    pendingByPath.delete(cliPath);
  }
}

export function latestSolModel(models: readonly AgentModelDefinition[]): string | undefined {
  const plainSol = /^gpt-\d+(?:\.\d+)?-sol$/;
  const byVersion = new Intl.Collator('en', { numeric: true });
  return models.reduce<string | undefined>((latest, { id }) => {
    if (!plainSol.test(id)) return latest;
    return !latest || byVersion.compare(id, latest) > 0 ? id : latest;
  }, undefined);
}

function discoverCodexModels(cliPath: string): Promise<AgentModelDefinition[]> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const reader = createInterface({ input: child.stdout });
    const models = new Map<string, AgentModelDefinition>();
    const cursors = new Set<string>();
    let requestId = 1;
    let finished = false;
    // Older CLI versions may not answer the catalogue request.
    const timeout = setTimeout(() => finish([]), 5000);

    function finish(result: AgentModelDefinition[]): void {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reader.close();
      child.stdin.end();
      child.kill();
      resolve(result);
    }

    function send(request: object): void {
      if (!finished) child.stdin.write(`${JSON.stringify(request)}\n`);
    }

    child.once('error', () => finish([]));
    child.once('close', () => finish([]));
    child.stdin.on('error', () => finish([]));
    reader.on('line', (line) => {
      let response: unknown;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(response) || response.id !== requestId) return;
      if (!isRecord(response.result)) return finish([]);
      if (requestId === 1) {
        send({ method: 'initialized' });
        send({ id: ++requestId, method: 'model/list', params: { includeHidden: false } });
        return;
      }
      if (!Array.isArray(response.result.data)) return finish([]);
      for (const row of response.result.data) {
        if (!isRecord(row) || row.hidden === true || typeof row.model !== 'string' || !row.model) continue;
        if (typeof row.displayName === 'string' && row.displayName) {
          models.set(row.model, { id: row.model, label: row.displayName });
        }
      }
      const cursor = response.result.nextCursor;
      if (typeof cursor !== 'string' || !cursor) return finish([...models.values()]);
      if (cursors.has(cursor)) return finish([]);
      cursors.add(cursor);
      send({ id: ++requestId, method: 'model/list', params: { includeHidden: false, cursor } });
    });
    send({ id: requestId, method: 'initialize', params: { clientInfo: { name: 'producer-player', version: '1' } } });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
