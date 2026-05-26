const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  handleProducerPlayerMcpRequest,
  resolveProducerPlayerMcpControlConfig,
  startProducerPlayerMcpControlServer,
} = require('../dist/mcp-control-server.test.cjs');

function testTool(name = 'pp_echo') {
  return {
    name,
    description: 'Echo test tool',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    },
    handler(args) {
      return { echoed: args.value ?? null };
    },
  };
}

test('MCP control config defaults to production-on and e2e-off unless explicitly enabled', () => {
  assert.equal(resolveProducerPlayerMcpControlConfig({}).enabled, true);
  assert.equal(
    resolveProducerPlayerMcpControlConfig({ PRODUCER_PLAYER_TEST_ID: 'test-run' }).enabled,
    false,
  );
  assert.deepEqual(
    resolveProducerPlayerMcpControlConfig({
      PRODUCER_PLAYER_TEST_ID: 'test-run',
      PRODUCER_PLAYER_MCP_HTTP_ENABLED: 'true',
      PRODUCER_PLAYER_MCP_HTTP_PORT: '0',
      PRODUCER_PLAYER_MCP_HTTP_TOKEN: 'secret',
    }),
    {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      token: 'secret',
    },
  );
});

test('MCP JSON-RPC handler supports initialize, tools/list, tools/call, and notifications', async () => {
  const tools = new Map([[testTool().name, testTool()]]);

  const initialized = await handleProducerPlayerMcpRequest(
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    tools,
  );
  assert.equal(initialized.result.serverInfo.name, 'producer-player');

  const listed = await handleProducerPlayerMcpRequest(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    tools,
  );
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ['pp_echo'],
  );

  const called = await handleProducerPlayerMcpRequest(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'pp_echo', arguments: { value: 'hello' } },
    },
    tools,
  );
  assert.deepEqual(called.result.structuredContent, { echoed: 'hello' });

  const unknown = await handleProducerPlayerMcpRequest(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'missing' } },
    tools,
  );
  assert.equal(unknown.error.code, -32602);

  const notification = await handleProducerPlayerMcpRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    tools,
  );
  assert.equal(notification, null);
});

test('HTTP MCP server enforces auth, writes token-free discovery, and dispatches tools', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'producer-player-mcp-test-'));
  const discoveryFilePath = path.join(directory, 'producer-player-mcp-control.json');
  const server = await startProducerPlayerMcpControlServer({
    config: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      token: 'secret-token',
    },
    tools: [testTool()],
    discoveryFilePath,
  });

  try {
    assert.ok(server);
    const port = server.port();
    const baseUrl = `http://127.0.0.1:${port}`;

    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).toolCount, 1);

    const discovery = JSON.parse(await readFile(discoveryFilePath, 'utf8'));
    assert.equal(discovery.port, port);
    assert.equal(discovery.tokenRequired, true);
    assert.equal(Object.prototype.hasOwnProperty.call(discovery, 'token'), false);
    assert.deepEqual(discovery.tools, ['pp_echo']);

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'pp_echo', arguments: { value: 'over-http' } },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.result.structuredContent, { echoed: 'over-http' });
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTP MCP server refuses non-loopback hosts without a token', async () => {
  const server = await startProducerPlayerMcpControlServer({
    config: {
      enabled: true,
      host: '0.0.0.0',
      port: 0,
      token: null,
    },
    tools: [testTool()],
    discoveryFilePath: path.join(tmpdir(), 'producer-player-mcp-refused.json'),
  });

  assert.equal(server, null);
});
