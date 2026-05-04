// Item #13 (v3.113) — agent-service argv-construction coverage for the
// dangerous bypass-permissions toggle.
//
// The setting is opt-in (default OFF). When ON, the spawned CLI must
// receive the provider's "dangerously bypass permission/approval gating"
// flag so the agent gets full file-system + shell access:
//   - Claude Code: --dangerously-skip-permissions
//   - Codex:       --dangerously-bypass-approvals-and-sandbox
//
// When OFF, the same flag MUST be absent so the CLI falls back to its
// normal interactive permission/approval flow. This is the safety
// guarantee that lets us ship the toggle as opt-in without regressing
// users who never flip it.
//
// We do NOT spawn the CLI in these tests — we just exercise
// `__testing__.getSpawnArgs`, which is the pure argv builder used by
// `sendTurn` / `startSession`.

const assert = require('node:assert/strict');
const test = require('node:test');

const { __testing__ } = require('../dist/agent-service.test.cjs');

// --- Claude --------------------------------------------------------------

test('Claude — bypass OFF: --dangerously-skip-permissions is NOT in argv', () => {
  const args = __testing__.getSpawnArgs({
    provider: 'claude',
    dangerouslyBypassPermissions: false,
  });
  assert.ok(
    !args.includes('--dangerously-skip-permissions'),
    `expected dangerous flag to be absent when OFF; got: ${args.join(' ')}`,
  );
  // Sanity: the rest of the Claude argv should still be intact.
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--no-session-persistence'));
});

test('Claude — bypass undefined defaults to OFF (safe-by-default)', () => {
  const args = __testing__.getSpawnArgs({ provider: 'claude' });
  assert.ok(
    !args.includes('--dangerously-skip-permissions'),
    'undefined must be treated as OFF',
  );
});

test('Claude — bypass ON: --dangerously-skip-permissions IS in argv', () => {
  const args = __testing__.getSpawnArgs({
    provider: 'claude',
    dangerouslyBypassPermissions: true,
  });
  assert.ok(
    args.includes('--dangerously-skip-permissions'),
    `expected dangerous flag when ON; got: ${args.join(' ')}`,
  );
  // Verify the flag sits before --no-session-persistence to keep the
  // existing relative argv ordering — some Claude CLI versions are picky
  // about flag groupings, so we lock it in.
  const dangerIdx = args.indexOf('--dangerously-skip-permissions');
  const sessionIdx = args.indexOf('--no-session-persistence');
  assert.ok(dangerIdx >= 0 && sessionIdx >= 0);
  assert.ok(
    dangerIdx < sessionIdx,
    'expected --dangerously-skip-permissions to precede --no-session-persistence',
  );
});

// --- Codex ---------------------------------------------------------------

test('Codex — bypass OFF: --dangerously-bypass-approvals-and-sandbox is NOT in argv', () => {
  const args = __testing__.getSpawnArgs({
    provider: 'codex',
    dangerouslyBypassPermissions: false,
  });
  assert.ok(
    !args.includes('--dangerously-bypass-approvals-and-sandbox'),
    `expected dangerous flag to be absent when OFF; got: ${args.join(' ')}`,
  );
  // Sanity: the rest of the Codex argv should still be intact.
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--json'));
  assert.equal(args[args.length - 1], '-');
});

test('Codex — bypass undefined defaults to OFF (safe-by-default)', () => {
  const args = __testing__.getSpawnArgs({ provider: 'codex' });
  assert.ok(
    !args.includes('--dangerously-bypass-approvals-and-sandbox'),
    'undefined must be treated as OFF',
  );
});

test('Codex — bypass ON: --dangerously-bypass-approvals-and-sandbox IS in argv', () => {
  const args = __testing__.getSpawnArgs({
    provider: 'codex',
    dangerouslyBypassPermissions: true,
  });
  assert.ok(
    args.includes('--dangerously-bypass-approvals-and-sandbox'),
    `expected dangerous flag when ON; got: ${args.join(' ')}`,
  );
  // The flag should sit between the env-shaping flags and the model/json
  // flags, matching the original (pre-v3.113) hardcoded ordering. Lock
  // it in so future refactors don't accidentally move it past `--json -`
  // and break stdin piping.
  const dangerIdx = args.indexOf('--dangerously-bypass-approvals-and-sandbox');
  const modelIdx = args.indexOf('--model');
  assert.ok(dangerIdx >= 0 && modelIdx >= 0);
  assert.ok(
    dangerIdx < modelIdx,
    'expected --dangerously-bypass-approvals-and-sandbox to precede --model',
  );
  // Stdin pipe sentinel must remain the very last argv entry.
  assert.equal(args[args.length - 1], '-');
});

// --- Cross-provider sanity ----------------------------------------------

test('Toggle ON does NOT cross-contaminate between providers', () => {
  const claudeOn = __testing__.getSpawnArgs({
    provider: 'claude',
    dangerouslyBypassPermissions: true,
  });
  const codexOn = __testing__.getSpawnArgs({
    provider: 'codex',
    dangerouslyBypassPermissions: true,
  });
  // Claude must not get Codex's flag and vice versa.
  assert.ok(!claudeOn.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!codexOn.includes('--dangerously-skip-permissions'));
});
