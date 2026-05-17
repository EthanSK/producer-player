import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// v3.226 — Codex MUST-FIX #2 regression guard. The pin-at-0 contract for
// click-free playback requires every direct-play entry point (paused → play
// on an already-loaded source) to set the GainNode to 0 BEFORE `audio.play()`
// resolves, so the `onPlaying` handler's ramp can mask the leading audio
// frames hitting the output device. v3.225 only enforced this on the main
// play button (`handlePlayPauseToggle`). Codex flagged three other direct-
// play paths that skipped the pin:
//   - App.tsx:11037 (song-row double-click — `song-row-double-click-played-current-selection`)
//   - App.tsx:13917 (quick-switcher — `quick-switcher-played-current-selection`)
//   - App.tsx:14101 (checklist-timestamp same-song — `handleSeek(seconds)` + `audio.play()`)
// All four now route through the shared `pinPlaybackGainBeforeDirectPlay`
// wrapper.
//
// This is a STATIC-SOURCE test: it reads App.tsx and asserts that every known
// direct-play call site is preceded by `pinPlaybackGainBeforeDirectPlay(`
// within a small text window. If a future refactor moves or renames a play
// path without keeping the pin, this test fails before the click-bug ships.

const APP_TSX_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  './App.tsx'
);
const APP_SOURCE = readFileSync(APP_TSX_PATH, 'utf8');

/**
 * For a given anchor string, locate its index in App.tsx and return the
 * preceding `WINDOW_CHARS` characters. The pin call should appear in that
 * preamble; the helper is named explicitly so a grep for it lands on the
 * right place.
 */
const WINDOW_CHARS = 600;

function preambleBefore(anchor: string): string {
  const idx = APP_SOURCE.indexOf(anchor);
  if (idx < 0) {
    throw new Error(
      `Anchor not found in App.tsx: ${JSON.stringify(anchor)}. ` +
        `Either the anchor was renamed or removed — update this test to ` +
        `point at the new canonical direct-play call site.`
    );
  }
  return APP_SOURCE.slice(Math.max(0, idx - WINDOW_CHARS), idx);
}

describe('pin-at-0 wrapper routing — all four direct-play paths (v3.226)', () => {
  it('exposes the shared pinPlaybackGainBeforeDirectPlay helper', () => {
    expect(APP_SOURCE).toMatch(/function pinPlaybackGainBeforeDirectPlay/);
  });

  it('main play button (handlePlayPauseToggle) pins before play-requested-direct', () => {
    // Anchor: the unique log emitted by the main play button path.
    const preamble = preambleBefore("logPlaybackEvent('play-requested-direct')");
    expect(preamble).toMatch(/pinPlaybackGainBeforeDirectPlay\(/);
  });

  it('song-row double-click pins before resuming current selection', () => {
    const preamble = preambleBefore(
      "logPlaybackEvent('song-row-double-click-played-current-selection')"
    );
    expect(preamble).toMatch(/pinPlaybackGainBeforeDirectPlay\(/);
  });

  it('quick-switcher pins before resuming current selection', () => {
    const preamble = preambleBefore(
      "logPlaybackEvent('quick-switcher-played-current-selection')"
    );
    expect(preamble).toMatch(/pinPlaybackGainBeforeDirectPlay\(/);
  });

  it('checklist-timestamp same-song path pins before audio.play()', () => {
    // This path is identified by the bare `handleSeek(seconds);` line followed
    // by `if (audio.paused) {` — see handleChecklistTimestampClick.
    // We anchor on the subsequent `audio.play()` callback. There's only one
    // `audio.paused` branch in handleChecklistTimestampClick after the seek.
    const seekIdx = APP_SOURCE.indexOf('handleSeek(seconds);');
    expect(seekIdx).toBeGreaterThan(-1);
    const afterSeek = APP_SOURCE.slice(seekIdx, seekIdx + WINDOW_CHARS);
    expect(afterSeek).toMatch(/pinPlaybackGainBeforeDirectPlay\(/);
    expect(afterSeek).toMatch(/audio\.play\(\)/);
  });
});
