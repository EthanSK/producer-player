// v3.110 — agent-service attachment-history coverage.
//
// Asserts that attachments dropped on earlier turns are replayed into the
// stdin prompt for every subsequent turn, so the model can recall files
// (especially screenshots / images) attached two or more turns ago instead
// of only seeing them on the turn they were sent on. Issue #12 from
// Ethan's batch: "It's claiming it can't pull up images from earlier
// turns. That's not good. It should be able to."
//
// Both Claude Code and Codex backends use the same `buildTurnPrompt`
// envelope (`buildAccumulatedAttachmentsSection`), so we verify both
// providers route through the same multi-turn logic.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { __testing__ } = require('../dist/agent-service.test.cjs');

function makeAttachment(overrides = {}) {
  return {
    path: path.join(os.tmpdir(), `pp-default-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`),
    name: 'screenshot.png',
    sizeBytes: 12_345,
    mimeType: 'image/png',
    ...overrides,
  };
}

/**
 * Strip the long header description from the <attached-files> block so
 * regex assertions match against the actual file lines, not the helpful
 * "if a path is marked 'no longer accessible' …" prose in the header.
 */
function attachmentLines(prompt) {
  const block = attachmentsBlock(prompt);
  if (!block) return null;
  // Header runs from `<attached-files>` to the first blank line after the
  // description; everything after that (and before the closing tag) is
  // the actual list of file lines.
  const headerEnd = block.indexOf('\n\n');
  if (headerEnd === -1) return block;
  const closingIdx = block.lastIndexOf('</attached-files>');
  return block.slice(headerEnd + 2, closingIdx);
}

function attachmentsBlock(prompt) {
  // Pull just the <attached-files>...</attached-files> region for focused
  // assertions; the rest of the prompt has system blocks / context blobs
  // we don't care about in these tests.
  const match = prompt.match(/<attached-files>[\s\S]*?<\/attached-files>/);
  return match ? match[0] : null;
}

// --- Single-turn baseline (regression guard) ------------------------------

test('current-turn attachment renders with "(current turn)" label', () => {
  const attach = makeAttachment();
  // Stage the file so attachmentStillAccessible() returns true.
  fs.writeFileSync(attach.path, '');
  try {
    const prompt = __testing__.buildTurnPrompt(
      { provider: 'claude', systemPrompt: 'sp', history: [] },
      'hello',
      { attachments: [attach] },
    );

    const lines = attachmentLines(prompt);
    assert.ok(lines, 'expected an <attached-files> block on the first turn');
    assert.match(lines, /screenshot\.png/);
    assert.match(lines, /\(current turn\)/);
    assert.match(lines, /image\/png/);
  } finally {
    try { fs.unlinkSync(attach.path); } catch {}
  }
});

test('no attachments anywhere → no <attached-files> block', () => {
  const prompt = __testing__.buildTurnPrompt(
    { provider: 'claude', systemPrompt: 'sp', history: [] },
    'just words',
  );
  assert.equal(attachmentsBlock(prompt), null);
});

// --- The actual gap fix: prior-turn attachments survive -------------------

test('Claude — image attached on turn 1 is included in turn 3 prompt', () => {
  const attach = makeAttachment({
    path: path.join(os.tmpdir(), `pp-test-${Date.now()}-keep.png`),
    name: 'keep.png',
  });
  fs.writeFileSync(attach.path, 'fake');
  try {
    let history = __testing__.appendUserTurn([], 'first turn user msg', [attach]);
    history = __testing__.appendAssistantTurn(history, 'first turn assistant msg');
    history = __testing__.appendUserTurn(history, 'second turn user msg');
    history = __testing__.appendAssistantTurn(history, 'second turn assistant msg');

    // Now build the prompt for the THIRD user turn. No new attachment on
    // this turn — the image came from turn 1.
    const prompt = __testing__.buildTurnPrompt(
      { provider: 'claude', systemPrompt: 'sp', history },
      'do you remember the image I sent first?',
    );

    const lines = attachmentLines(prompt);
    assert.ok(lines, 'expected the <attached-files> block to persist from turn 1');
    assert.match(lines, /keep\.png/);
    assert.match(lines, /from user turn #1/);
    assert.doesNotMatch(lines, /no longer accessible/);
  } finally {
    try { fs.unlinkSync(attach.path); } catch {}
  }
});

test('Codex — image attached on turn 1 is included in turn 3 prompt', () => {
  const attach = makeAttachment({
    path: path.join(os.tmpdir(), `pp-test-${Date.now()}-codex.png`),
    name: 'codex.png',
  });
  fs.writeFileSync(attach.path, 'fake');
  try {
    let history = __testing__.appendUserTurn([], 'turn 1', [attach]);
    history = __testing__.appendAssistantTurn(history, 'r1');
    history = __testing__.appendUserTurn(history, 'turn 2');
    history = __testing__.appendAssistantTurn(history, 'r2');

    const prompt = __testing__.buildTurnPrompt(
      { provider: 'codex', systemPrompt: 'sp', history },
      'turn 3 — what was the image?',
    );

    const lines = attachmentLines(prompt);
    assert.ok(lines, 'expected attachments block on Codex turn 3');
    assert.match(lines, /codex\.png/);
    assert.match(lines, /from user turn #1/);
    // The Codex envelope wraps the system prompt inline; verify that path too.
    assert.match(prompt, /<agent-system-prompt>/);
  } finally {
    try { fs.unlinkSync(attach.path); } catch {}
  }
});

// --- Dedup + multi-turn ordering ------------------------------------------

test('attachments dedup by absolute path across multiple turns', () => {
  const sharedPath = path.join(os.tmpdir(), `pp-test-${Date.now()}-dedup.png`);
  fs.writeFileSync(sharedPath, 'fake');
  const attach1 = makeAttachment({ path: sharedPath, name: 'shared.png' });
  // Same path on a later turn — should NOT be listed twice.
  const attach2 = makeAttachment({ path: sharedPath, name: 'shared.png' });
  try {
    let history = __testing__.appendUserTurn([], 'turn 1', [attach1]);
    history = __testing__.appendAssistantTurn(history, 'r1');
    history = __testing__.appendUserTurn(history, 'turn 2', [attach2]);
    history = __testing__.appendAssistantTurn(history, 'r2');

    const prompt = __testing__.buildTurnPrompt(
      { provider: 'claude', systemPrompt: 'sp', history },
      'turn 3',
    );
    const lines = attachmentLines(prompt);
    assert.ok(lines);
    const occurrences = lines.match(/shared\.png/g) ?? [];
    assert.equal(occurrences.length, 1, 'duplicate paths should be deduped');
  } finally {
    try { fs.unlinkSync(sharedPath); } catch {}
  }
});

test('current-turn attachment plus past attachment both appear, with correct labels', () => {
  const oldPath = path.join(os.tmpdir(), `pp-test-${Date.now()}-old.png`);
  const newPath = path.join(os.tmpdir(), `pp-test-${Date.now()}-new.png`);
  fs.writeFileSync(oldPath, 'fake');
  fs.writeFileSync(newPath, 'fake');
  try {
    let history = __testing__.appendUserTurn(
      [],
      'turn 1',
      [makeAttachment({ path: oldPath, name: 'old.png' })],
    );
    history = __testing__.appendAssistantTurn(history, 'r1');

    const prompt = __testing__.buildTurnPrompt(
      { provider: 'claude', systemPrompt: 'sp', history },
      'turn 2',
      { attachments: [makeAttachment({ path: newPath, name: 'new.png' })] },
    );

    const lines = attachmentLines(prompt);
    assert.ok(lines);
    assert.match(lines, /old\.png .*from user turn #1/);
    assert.match(lines, /new\.png .*\(current turn\)/);
  } finally {
    try { fs.unlinkSync(oldPath); } catch {}
    try { fs.unlinkSync(newPath); } catch {}
  }
});

// --- Missing-file surfacing -----------------------------------------------

test('past-turn attachment whose file is gone surfaces "no longer accessible" instead of silently dropping', () => {
  const ghostPath = path.join(os.tmpdir(), `pp-test-${Date.now()}-ghost.png`);
  // DON'T create the file — simulate it having been swept.
  const attach = makeAttachment({ path: ghostPath, name: 'ghost.png' });

  let history = __testing__.appendUserTurn([], 'turn 1', [attach]);
  history = __testing__.appendAssistantTurn(history, 'r1');

  const prompt = __testing__.buildTurnPrompt(
    { provider: 'claude', systemPrompt: 'sp', history },
    'turn 2',
  );
  const lines = attachmentLines(prompt);
  assert.ok(lines, 'missing files should still appear in the block, not be dropped');
  assert.match(lines, /ghost\.png/);
  assert.match(lines, /no longer accessible/);
});

// --- Seed-history round trip ----------------------------------------------

test('normalizeSeedHistory preserves attachments and assigns user turn indices', () => {
  const attach = makeAttachment({ name: 'seed.png' });
  const seed = [
    { role: 'user', content: 'first', attachments: [attach] },
    { role: 'assistant', content: 'response' },
    { role: 'user', content: 'second' },
  ];
  const normalized = __testing__.normalizeSeedHistory(seed);
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized[0].attachments, [attach]);
  assert.equal(normalized[0].turnIndex, 1);
  assert.equal(normalized[1].turnIndex, undefined); // assistants have no turn index
  assert.equal(normalized[2].turnIndex, 2);
});

test('normalizeSeedHistory drops malformed attachment entries safely', () => {
  const seed = [
    {
      role: 'user',
      content: 'mixed',
      attachments: [
        { path: '/tmp/ok.png', name: 'ok.png', sizeBytes: 1, mimeType: 'image/png' },
        { path: '', name: 'bad.png' }, // missing path
        null,
        'string-not-an-object',
      ],
    },
  ];
  const normalized = __testing__.normalizeSeedHistory(seed);
  assert.equal(normalized.length, 1);
  assert.ok(Array.isArray(normalized[0].attachments));
  assert.equal(normalized[0].attachments.length, 1);
  assert.equal(normalized[0].attachments[0].name, 'ok.png');
});
