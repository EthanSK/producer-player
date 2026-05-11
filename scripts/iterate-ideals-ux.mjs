/**
 * iterate-ideals-ux.mjs
 *
 * Headless screenshot harness for the IdealsModal UX-iteration loop. Starts
 * the renderer Vite dev server (port 4207), drives a headless Chromium against
 * /ideals-harness.html with a variety of state params, and writes a numbered
 * PNG per state into /tmp/pp-ideals-shots/<iteration>/.
 *
 * Usage:
 *   node scripts/iterate-ideals-ux.mjs --iteration 01
 *
 * Or programmatically (recommended for the agent's loop):
 *   node scripts/iterate-ideals-ux.mjs --iteration 01 --only ready
 *
 * Flags:
 *   --iteration <name>     subdir under /tmp/pp-ideals-shots
 *   --only <state>         only render this one harness state (idle | ready
 *                          | fullscreen | empty)
 *   --keep-server          do NOT shut down the dev server on exit (faster
 *                          subsequent iterations)
 *   --port <n>             vite port (default 4207)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(repoRoot, 'apps/renderer');

function parseArgs() {
  const args = { iteration: 'latest', only: null, keepServer: false, port: 4207 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--iteration') args.iteration = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--keep-server') args.keepServer = true;
    else if (a === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(250);
  }
  throw new Error(`Vite server did not come up at ${url} within ${timeoutMs}ms.`);
}

async function isPortInUse(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    return res.ok || res.status >= 200;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs();
  const outDir = path.join('/tmp/pp-ideals-shots', args.iteration);
  await fs.mkdir(outDir, { recursive: true });

  const baseUrl = `http://127.0.0.1:${args.port}`;

  let viteProc = null;
  if (!(await isPortInUse(args.port))) {
    viteProc = spawn('npm', ['run', 'dev'], {
      cwd: rendererRoot,
      env: { ...process.env, PRODUCER_PLAYER_HOT_RELOAD: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteProc.stdout?.on('data', (b) => process.stderr.write(`[vite] ${b}`));
    viteProc.stderr?.on('data', (b) => process.stderr.write(`[vite] ${b}`));
    await waitForServer(`${baseUrl}/ideals-harness.html`);
  } else {
    process.stderr.write(`[harness] reusing existing vite at :${args.port}\n`);
  }

  const browser = await chromium.launch();
  try {
    // Use a realistic viewport matching the screenshot script (1440×900,
    // 16:10) so the modal looks like what users actually see. The modal
    // scrolls internally — the harness captures one full-page screenshot
    // per state, but to also see "below the fold" we use a slightly taller
    // viewport for richer ready/learn-mode shots.
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        process.stderr.write(`[browser ${msg.type()}] ${msg.text()}\n`);
      }
    });
    page.on('pageerror', (err) => {
      process.stderr.write(`[browser pageerror] ${err.message}\n`);
    });

    const states = [
      {
        name: 'idle-with-mix',
        url: `${baseUrl}/ideals-harness.html?state=idle&mix=true&ref=false`,
      },
      {
        name: 'ready-mix-and-reference',
        url: `${baseUrl}/ideals-harness.html?state=ready&mix=true&ref=true`,
      },
      {
        name: 'ready-with-diff',
        url: `${baseUrl}/ideals-harness.html?state=ready&mix=true&ref=true&layers=ideal,mix,reference,diff`,
      },
      {
        name: 'ready-diff-only',
        url: `${baseUrl}/ideals-harness.html?state=ready&mix=true&ref=true&layers=diff`,
      },
      {
        name: 'ready-compact-density',
        url: `${baseUrl}/ideals-harness.html?state=ready&mix=true&ref=true&density=compact`,
      },
      {
        name: 'ready-learn-mode',
        url: `${baseUrl}/ideals-harness.html?state=ready&mix=true&ref=true&tips=true`,
      },
      {
        name: 'fullscreen-vocals',
        url: `${baseUrl}/ideals-harness.html?state=fullscreen&full=vocals&mix=true&ref=true`,
      },
      {
        name: 'empty-no-sources',
        url: `${baseUrl}/ideals-harness.html?state=idle&mix=false&ref=false`,
      },
    ];

    for (const state of states) {
      if (args.only && state.name !== args.only) continue;
      process.stderr.write(`[harness] capturing ${state.name}\n`);
      await page.goto(state.url, { waitUntil: 'networkidle' });
      // Wait for the harness bootstrap to finish preloading the analysis
      // cache and mount React.
      await page.waitForFunction(() => window.__HARNESS_READY === true, null, { timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="ideals-modal"]', { timeout: 5000 });
      // Wait for harness overrides (programmatic toggle clicks) to apply.
      await page.waitForFunction(() => window.__HARNESS_OVERRIDES_APPLIED === true, null, { timeout: 5000 }).catch(() => {});
      // Force hover/animation states to settle.
      await wait(450);
      const file = path.join(outDir, `${state.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      process.stderr.write(`[harness] wrote ${file}\n`);
    }
  } finally {
    await browser.close();
    if (viteProc && !args.keepServer) {
      viteProc.kill('SIGTERM');
    }
  }

  process.stderr.write(`[harness] done. Shots in ${outDir}\n`);
  console.log(outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
