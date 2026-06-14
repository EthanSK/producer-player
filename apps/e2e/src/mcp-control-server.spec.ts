import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

interface McpDiscovery {
  url: string;
  healthUrl: string;
  tokenRequired: boolean;
  tools: string[];
}

function platformMetadataAssetName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml';
  if (process.platform === 'linux') return 'latest-linux.yml';
  if (process.platform === 'win32') return 'latest.yml';
  return 'latest.yml';
}

function platformPackageAssetName(version: string): string {
  if (process.platform === 'darwin') return 'Producer-Player-' + version + '-mac-universal.zip';
  if (process.platform === 'linux') return 'Producer-Player-' + version + '-linux-x64.AppImage';
  if (process.platform === 'win32') return 'Producer-Player-' + version + '-win-x64.exe';
  return 'Producer-Player-' + version + '-unknown.zip';
}

function releaseFixture(tagName: string, version: string) {
  return {
    tag_name: tagName,
    html_url: 'https://github.com/EthanSK/producer-player/releases/tag/' + tagName,
    name: tagName,
    published_at: '2026-05-25T12:00:00.000Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: platformMetadataAssetName(),
        browser_download_url: 'https://example.invalid/' + version + '/' + platformMetadataAssetName(),
      },
      {
        name: platformPackageAssetName(version),
        browser_download_url: 'https://example.invalid/' + version + '/installer',
      },
    ],
  };
}

async function readDiscovery(userDataDirectory: string): Promise<McpDiscovery> {
  const discoveryPath = path.join(userDataDirectory, 'producer-player-mcp-control.json');
  await expect
    .poll(async () => {
      try {
        const raw = await fs.readFile(discoveryPath, 'utf8');
        return JSON.parse(raw) as McpDiscovery;
      } catch {
        return null;
      }
    })
    .not.toBeNull();

  return JSON.parse(await fs.readFile(discoveryPath, 'utf8')) as McpDiscovery;
}

async function readRootPackageVersion(): Promise<string> {
  const packageJsonPath = path.resolve(__dirname, '../../../package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== 'string') {
    throw new Error('Root package.json is missing a string version.');
  }
  return packageJson.version;
}

async function callMcpTool(discovery: McpDiscovery, token: string, name: string, args: unknown = {}) {
  const response = await fetch(discovery.url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name + '-' + Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  });

  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  return payload.result.structuredContent;
}

test.describe('Producer Player MCP-over-HTTP control server', () => {
  test('exposes UI control and exact-version install tools over authenticated local MCP HTTP', async () => {
    const dirs = await createE2ETestDirectories('mcp-control-server');
    const token = 'e2e-mcp-token';
    const recordPath = path.join(dirs.userDataDirectory, 'mcp-install-record.json');
    const scriptPath = path.join(dirs.userDataDirectory, 'mcp-custom-script.sh');
    const packageVersion = await readRootPackageVersion();
    const releases = [
      releaseFixture('v3.265.0', '3.265.0'),
      releaseFixture('v3.264.0', '3.264.0'),
    ];
    await fs.writeFile(
      scriptPath,
      [
        'printf "MCP_CUSTOM_SCRIPT_OK\\n"',
        'printf "MCP_SONG=%s\\n" "$PRODUCER_PLAYER_SELECTED_SONG_TITLE"',
        'printf "MCP_CWD=%s\\n" "$PWD"',
        '',
      ].join('\n'),
      'utf8',
    );

    const { electronApp } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_MCP_HTTP_ENABLED: 'true',
        PRODUCER_PLAYER_MCP_HTTP_PORT: '0',
        PRODUCER_PLAYER_MCP_HTTP_TOKEN: token,
        PRODUCER_PLAYER_E2E_DOWNGRADE_RELEASES_JSON: JSON.stringify(releases),
        PRODUCER_PLAYER_E2E_DOWNGRADE_RECORD_PATH: recordPath,
      },
    });

    try {
      const discovery = await readDiscovery(dirs.userDataDirectory);
      expect(discovery.tokenRequired).toBe(true);
      expect(discovery.tools).toEqual(
        expect.arrayContaining([
          'pp_get_environment',
          'pp_get_library_snapshot',
          'pp_dom_snapshot',
          'pp_run_js',
          'pp_get_custom_script',
          'pp_set_custom_script',
          'pp_clear_custom_script',
          'pp_run_custom_script',
          'pp_update_check',
          'pp_update_download',
          'pp_update_install_downloaded',
          'pp_install_version',
        ]),
      );

      const unauthorized = await fetch(discovery.healthUrl);
      expect(unauthorized.status).toBe(401);

      const environment = await callMcpTool(discovery, token, 'pp_get_environment');
      expect(environment.environment.appVersion.semanticVersion).toBe(packageVersion);
      expect(environment.mcp.port).toEqual(expect.any(Number));

      const domSnapshot = await callMcpTool(discovery, token, 'pp_dom_snapshot', {
        rootSelector: '[data-testid="app-shell"]',
        maxNodes: 25,
      });
      expect(domSnapshot.ok).toBe(true);
      expect(domSnapshot.nodeCount).toBeGreaterThan(0);

      const runJs = await callMcpTool(discovery, token, 'pp_run_js', {
        code: 'document.querySelector("[data-testid=app-shell]") !== null',
      });
      expect(runJs).toEqual({ ok: true, value: true });

      const savedCustomScript = await callMcpTool(discovery, token, 'pp_set_custom_script', {
        name: 'MCP Hook',
        filePath: scriptPath,
      });
      expect(savedCustomScript.customScript).toEqual({
        name: 'MCP Hook',
        filePath: scriptPath,
      });

      const customScript = await callMcpTool(discovery, token, 'pp_get_custom_script');
      expect(customScript.customScript).toEqual({
        name: 'MCP Hook',
        filePath: scriptPath,
      });

      const scriptRun = await callMcpTool(discovery, token, 'pp_run_custom_script', {
        context: {
          selectedFolderPath: dirs.fixtureDirectory,
          selectedSongTitle: 'MCP Song',
        },
      });
      expect(scriptRun.ok).toBe(true);
      expect(scriptRun.stdout).toContain('MCP_CUSTOM_SCRIPT_OK');
      expect(scriptRun.stdout).toContain('MCP_SONG=MCP Song');
      expect(scriptRun.stdout).toContain(`MCP_CWD=${dirs.fixtureDirectory}`);

      const clearedCustomScript = await callMcpTool(discovery, token, 'pp_clear_custom_script');
      expect(clearedCustomScript.customScript).toBeNull();

      const installResult = await callMcpTool(discovery, token, 'pp_install_version', {
        version: '3.264',
      });
      expect(installResult).toMatchObject({
        status: 'downloading',
        direction: 'downgrade',
        targetVersion: '3.264',
        targetTag: 'v3.264.0',
      });

      await expect
        .poll(async () => {
          try {
            return JSON.parse(await fs.readFile(recordPath, 'utf8'));
          } catch {
            return null;
          }
        })
        .toMatchObject({
          requestedVersion: '3.264',
          targetVersion: '3.264',
          targetTag: 'v3.264.0',
          direction: 'downgrade',
        });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
