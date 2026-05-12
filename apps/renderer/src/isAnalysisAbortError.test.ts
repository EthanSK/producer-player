// v3.198 — Defensive AbortError-detection for v3.195's preempt+cancel
// pathway. The AnalysisQueue silently requeues preempted tasks, but a
// belt-and-braces guard at every `runMeasuredAnalysis` consumer ensures
// that even if an AbortError leaks through (direct cancel, future edge
// case, or simply the IPC-serialized AnalysisAbortError reaching the
// catch handler), the consumer does NOT flip its row to a misleading
// `status: 'error'` state. The classic symptom this prevents: cold-
// launch warmup with 30+ tracks, user clicks around during warmup, and
// every preempted song-row's top-right LUFS badge flips to "Error"
// because the abort was treated as a real failure.

import { describe, expect, it } from 'vitest';

import { isAnalysisAbortError } from './App';
import { AnalysisTaskPreemptedError, AnalysisTaskTimeoutError } from './audioAnalysisQueue';

describe('isAnalysisAbortError', () => {
  it('returns true for a DOMException with name=AbortError (Web standard cancel)', () => {
    // Mirrors what the renderer-side analyzeTrackFromUrl decode throws when
    // its AbortSignal fires.
    const err = new DOMException('aborted', 'AbortError');
    expect(isAnalysisAbortError(err)).toBe(true);
  });

  it("returns true for a plain Error whose name is 'AbortError' (IPC-serialized AnalysisAbortError)", () => {
    // Electron's IPC preserves Error.name across the main↔renderer boundary,
    // so the main-process AnalysisAbortError surfaces here as a regular
    // Error with name='AbortError'. This is the case Ethan was hitting after
    // v3.195 — preempted warmup → SIGKILL'd ffmpeg → this error → checklist
    // item flips to "Error" without the guard.
    const err = new Error('Analysis request m-abc was aborted');
    err.name = 'AbortError';
    expect(isAnalysisAbortError(err)).toBe(true);
  });

  it('returns true for AnalysisTaskPreemptedError (queue-internal preempt signal)', () => {
    const err = new AnalysisTaskPreemptedError('track::cache-key');
    expect(isAnalysisAbortError(err)).toBe(true);
  });

  it('returns false for AnalysisTaskTimeoutError (real timeout, NOT a cancel)', () => {
    const err = new AnalysisTaskTimeoutError({
      key: 'track::cache-key',
      priority: 1,
      label: 'measured-analysis',
      timeoutMs: 60_000,
    });
    expect(isAnalysisAbortError(err)).toBe(false);
  });

  it('returns false for a generic Error from ffmpeg failure', () => {
    // The actual failure mode we WANT to surface to the user — e.g.
    // ffmpeg exiting non-zero on a malformed WAV. Must still flip to
    // `status: 'error'` so the UI shows the failure.
    const err = new Error('ffmpeg exited with 1. Invalid data found when processing input');
    expect(isAnalysisAbortError(err)).toBe(false);
  });

  it('returns false for null / undefined / primitives', () => {
    expect(isAnalysisAbortError(null)).toBe(false);
    expect(isAnalysisAbortError(undefined)).toBe(false);
    expect(isAnalysisAbortError('AbortError')).toBe(false);
    expect(isAnalysisAbortError(0)).toBe(false);
    expect(isAnalysisAbortError(false)).toBe(false);
  });

  it('returns false for an object with a non-matching name', () => {
    expect(isAnalysisAbortError({ name: 'TypeError' })).toBe(false);
    expect(isAnalysisAbortError({ name: 'NetworkError' })).toBe(false);
    expect(isAnalysisAbortError({})).toBe(false);
  });
});
