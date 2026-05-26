// In-app agent policy coverage.
//
// The embedded Producer Player chat lets Claude/Codex control ordinary UI via
// pp_run_js / pp_dom_snapshot / pp_screenshot, but that same in-app channel
// must not become an updater/downgrader/installer. These tests lock the
// service-owned prompt block that gets prepended even when the user edits the
// visible mastering prompt in Agent Settings.

const assert = require('node:assert/strict');
const test = require('node:test');

const { __testing__ } = require('../dist/agent-service.test.cjs');

test('effective system prompt always includes UI-control primitives and lifecycle ban', () => {
  const prompt = __testing__.buildEffectiveSystemPrompt('Custom mastering voice.');

  assert.match(prompt, /<producer-player-host-policy>/);
  assert.match(prompt, /pp_run_js/);
  assert.match(prompt, /pp_dom_snapshot/);
  assert.match(prompt, /pp_screenshot/);
  assert.match(prompt, /autoUpdateDowngrade/);
  assert.match(prompt, /cannot run|Do not update/);
  assert.match(prompt, /<producer-player-user-configurable-prompt>/);
  assert.match(prompt, /Custom mastering voice\./);
});

test('effective system prompt strips stale embedded host-policy blocks before adding canonical policy', () => {
  const stalePrompt = [
    '<producer-player-host-policy>',
    'old stale policy mentioning pp_run_js once',
    '</producer-player-host-policy>',
    'User custom section.',
  ].join('\n');
  const prompt = __testing__.buildEffectiveSystemPrompt(stalePrompt);

  const policyOccurrences = prompt.match(/<producer-player-host-policy>/g) ?? [];
  assert.equal(policyOccurrences.length, 1);
  assert.doesNotMatch(prompt, /old stale policy/);
  assert.match(prompt, /User custom section\./);
});

test('Claude spawn argv carries host policy even with a custom system prompt', () => {
  const args = __testing__.getSpawnArgs({
    provider: 'claude',
    model: 'claude-haiku-4-5',
    thinking: 'medium',
    systemPrompt: 'Custom Claude prompt.',
  });
  const systemPrompt = args[args.indexOf('--system-prompt') + 1];

  assert.match(systemPrompt, /pp_run_js/);
  assert.match(systemPrompt, /pp_dom_snapshot/);
  assert.match(systemPrompt, /pp_screenshot/);
  assert.match(systemPrompt, /autoUpdateInstall/);
  assert.match(systemPrompt, /Custom Claude prompt\./);
});

test('Codex turn prompt wraps the effective host policy around custom text', () => {
  const prompt = __testing__.buildTurnPrompt(
    { provider: 'codex', systemPrompt: 'Custom Codex prompt.', history: [] },
    'control the UI',
  );

  assert.match(prompt, /<agent-system-prompt>/);
  assert.match(prompt, /pp_run_js/);
  assert.match(prompt, /pp_dom_snapshot/);
  assert.match(prompt, /pp_screenshot/);
  assert.match(prompt, /autoUpdateDownload/);
  assert.match(prompt, /Custom Codex prompt\./);
});

