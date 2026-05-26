import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_MCP_CONTROL_HOST = '127.0.0.1';
export const DEFAULT_MCP_CONTROL_PORT = 43733;
export const MCP_CONTROL_DISCOVERY_FILE = 'producer-player-mcp-control.json';

export interface ProducerPlayerMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ProducerPlayerMcpControlConfig {
  enabled: boolean;
  host: string;
  port: number;
  token: string | null;
}

export interface ProducerPlayerMcpControlServer {
  close(): Promise<void>;
  port(): number | null;
}

export interface StartProducerPlayerMcpControlServerOptions {
  config: ProducerPlayerMcpControlConfig;
  tools: ProducerPlayerMcpTool[];
  discoveryFilePath: string;
  logger?: {
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePortEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body exceeds 1 MB.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

function toolResult(value: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

function isAuthorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) {
    return true;
  }

  const authorization = req.headers.authorization;
  if (authorization === `Bearer ${token}`) {
    return true;
  }

  return req.headers['x-producer-player-token'] === token;
}

function sanitizeHost(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_MCP_CONTROL_HOST;
  }

  // Keep the default safe. Binding to all interfaces is allowed only when the
  // operator explicitly sets it, but the config surface still records the value
  // so agents can discover the real endpoint.
  return trimmed;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function resolveProducerPlayerMcpControlConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProducerPlayerMcpControlConfig {
  const isElectronTestLaunch =
    env.APP_TEST_MODE === 'true' ||
    (typeof env.PRODUCER_PLAYER_TEST_ID === 'string' && env.PRODUCER_PLAYER_TEST_ID.length > 0);

  return {
    // Production/dev launches expose the local agent port by default. E2E
    // launches opt in per spec with PRODUCER_PLAYER_MCP_HTTP_ENABLED=true so
    // parallel Playwright workers do not fight over the fixed default port.
    enabled: parseBooleanEnv(env.PRODUCER_PLAYER_MCP_HTTP_ENABLED, !isElectronTestLaunch),
    host: sanitizeHost(env.PRODUCER_PLAYER_MCP_HTTP_HOST),
    port: parsePortEnv(env.PRODUCER_PLAYER_MCP_HTTP_PORT, DEFAULT_MCP_CONTROL_PORT),
    token:
      typeof env.PRODUCER_PLAYER_MCP_HTTP_TOKEN === 'string' &&
      env.PRODUCER_PLAYER_MCP_HTTP_TOKEN.trim().length > 0
        ? env.PRODUCER_PLAYER_MCP_HTTP_TOKEN.trim()
        : null,
  };
}

export function createProducerPlayerMcpTools(
  tools: ProducerPlayerMcpTool[],
): Map<string, ProducerPlayerMcpTool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export async function handleProducerPlayerMcpRequest(
  request: JsonRpcRequest,
  toolsByName: Map<string, ProducerPlayerMcpTool>,
): Promise<Record<string, unknown> | null> {
  const id = request.id ?? null;

  // Notifications have no id. MCP clients commonly send initialized as a
  // notification; returning null tells the HTTP handler to send an empty 202.
  if (request.id === undefined && request.method?.startsWith('notifications/')) {
    return null;
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request.');
  }

  if (request.method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'producer-player',
        version: '3.265.0',
      },
    });
  }

  if (request.method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (request.method === 'tools/list') {
    return jsonRpcResult(id, {
      tools: [...toolsByName.values()].map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  }

  if (request.method === 'tools/call') {
    const params = isRecord(request.params) ? request.params : {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = isRecord(params.arguments) ? params.arguments : {};
    const tool = toolsByName.get(name);

    if (!tool) {
      return jsonRpcError(id, -32602, `Unknown Producer Player tool: ${name || '(missing)'}`);
    }

    try {
      return jsonRpcResult(id, toolResult(await tool.handler(args)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonRpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: message }],
      });
    }
  }

  return jsonRpcError(id, -32601, `Unsupported MCP method: ${request.method}`);
}

export async function startProducerPlayerMcpControlServer(
  options: StartProducerPlayerMcpControlServerOptions,
): Promise<ProducerPlayerMcpControlServer | null> {
  if (!options.config.enabled) {
    options.logger?.info?.('[producer-player:mcp] HTTP MCP control server disabled');
    return null;
  }

  if (!isLoopbackHost(options.config.host) && !options.config.token) {
    // A local MCP port is intentionally useful for host agents. Binding that
    // same control surface to LAN/Tailscale without a token would expose UI
    // eval and updater controls to the network, so refuse the server instead
    // of silently opening an unauthenticated remote control port.
    options.logger?.warn?.('[producer-player:mcp] refusing non-loopback MCP bind without token', {
      host: options.config.host,
    });
    return null;
  }

  const toolsByName = createProducerPlayerMcpTools(options.tools);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${options.config.host}`);

    if (!isAuthorized(req, options.config.token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        name: 'producer-player',
        protocol: 'mcp-over-http',
        toolCount: toolsByName.size,
      });
      return;
    }

    if (req.method !== 'POST' || url.pathname !== '/mcp') {
      sendJson(res, 404, {
        error: 'Use POST /mcp for JSON-RPC MCP requests, or GET /health.',
      });
      return;
    }

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(await readRequestBody(req)) as JsonRpcRequest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, jsonRpcError(null, -32700, message));
      return;
    }

    const response = await handleProducerPlayerMcpRequest(parsed, toolsByName);
    if (!response) {
      res.writeHead(202, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    sendJson(res, 200, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.port, options.config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : options.config.port;
  const discovery = {
    name: 'producer-player',
    protocol: 'mcp-over-http',
    host: options.config.host,
    port: actualPort,
    url: `http://${options.config.host}:${actualPort}/mcp`,
    healthUrl: `http://${options.config.host}:${actualPort}/health`,
    tokenRequired: Boolean(options.config.token),
    tools: options.tools.map((tool) => tool.name),
    updatedAt: new Date().toISOString(),
  };

  try {
    await mkdir(dirname(options.discoveryFilePath), { recursive: true });
    await writeFile(options.discoveryFilePath, JSON.stringify(discovery, null, 2), 'utf8');
  } catch (error) {
    options.logger?.warn?.('[producer-player:mcp] failed to write discovery file', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  options.logger?.info?.('[producer-player:mcp] HTTP MCP control server listening', {
    host: options.config.host,
    port: actualPort,
    discoveryFilePath: options.discoveryFilePath,
    tokenRequired: Boolean(options.config.token),
  });

  return {
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    port() {
      return actualPort;
    },
  };
}
