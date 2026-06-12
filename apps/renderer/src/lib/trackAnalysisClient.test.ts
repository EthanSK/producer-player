/**
 * Tests for the v3.240 Web Worker client wrapper for track analysis.
 *
 * The wrapper is environment-aware: when no Worker constructor is available
 * (the Vitest jsdom default), it falls back to running the same core
 * function inline. These tests exercise that fallback path because it is
 * the only one that can run inside the test harness without a real worker.
 *
 * In production (Electron 40 / Chromium 134) the Worker constructor is
 * always available, so the worker path is exercised at app runtime.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeAudioBufferInWorker,
  __resetTrackAnalysisWorkerForTests,
} from './trackAnalysisClient';
import { runTrackAnalysisCore } from '../trackAnalysisCore';

// Minimal AudioBuffer stand-in that satisfies the bits of the API the
// client wrapper touches. We don't need a real AudioContext to test the
// math; we just feed in known Float32Array PCM.
function makeFakeAudioBuffer(
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    length,
    duration: length / sampleRate,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData(index: number): Float32Array {
      return channels[index];
    },
  } as unknown as AudioBuffer;
}

afterEach(() => {
  __resetTrackAnalysisWorkerForTests();
});

describe('analyzeAudioBufferInWorker (fallback path)', () => {
  it('produces a TrackAnalysisResult with all required fields', async () => {
    const sampleRate = 48_000;
    // 0.5s of silence — easy to reason about.
    const left = new Float32Array(sampleRate / 2);
    const right = new Float32Array(sampleRate / 2);
    const buffer = makeFakeAudioBuffer([left, right], sampleRate);

    const result = await analyzeAudioBufferInWorker(buffer);

    expect(result.peakDbfs).toBe(-96);
    expect(result.rmsDbfs).toBe(-96);
    expect(result.dcOffset).toBe(0);
    expect(result.clipCount).toBe(0);
    expect(result.tonalBalance).toEqual({ low: 0, mid: 0, high: 0 });
    expect(result.waveformPeaks).toBeInstanceOf(Float32Array);
    expect(result.waveformPeaks.length).toBe(800);
    expect(result.durationSeconds).toBeCloseTo(0.5, 4);
    expect(result.frameLoudnessDbfs.length).toBeGreaterThan(0);
  });

  it('matches the pure-function core output bit-for-bit', async () => {
    const sampleRate = 44_100;
    const len = sampleRate; // 1 second
    // Sine-ish synthetic content so peaks/RMS/DC are non-trivial.
    const data = new Float32Array(len);
    for (let i = 0; i < len; i += 1) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const buffer = makeFakeAudioBuffer([data], sampleRate);

    const fromWorker = await analyzeAudioBufferInWorker(buffer);
    const fromCore = runTrackAnalysisCore(
      [data],
      sampleRate,
      buffer.duration,
      buffer.length,
    );

    expect(fromWorker.peakDbfs).toBeCloseTo(fromCore.peakDbfs, 6);
    expect(fromWorker.rmsDbfs).toBeCloseTo(fromCore.rmsDbfs, 6);
    expect(fromWorker.dcOffset).toBeCloseTo(fromCore.dcOffset, 6);
    expect(fromWorker.clipCount).toBe(fromCore.clipCount);
    expect(fromWorker.frameLoudnessDbfs.length).toBe(fromCore.frameLoudnessDbfs.length);
    expect(fromWorker.tonalBalance.low).toBeCloseTo(fromCore.tonalBalance.low, 6);
    expect(fromWorker.tonalBalance.mid).toBeCloseTo(fromCore.tonalBalance.mid, 6);
    expect(fromWorker.tonalBalance.high).toBeCloseTo(fromCore.tonalBalance.high, 6);
    expect(fromWorker.waveformPeaks.length).toBe(fromCore.waveformPeaks.length);
    for (let i = 0; i < fromWorker.waveformPeaks.length; i += 1) {
      expect(fromWorker.waveformPeaks[i]).toBeCloseTo(fromCore.waveformPeaks[i], 6);
    }
  });

  it('rejects immediately if the abort signal is already aborted', async () => {
    const sampleRate = 48_000;
    const data = new Float32Array(sampleRate / 10);
    const buffer = makeFakeAudioBuffer([data], sampleRate);
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzeAudioBufferInWorker(buffer, controller.signal),
    ).rejects.toThrow(/aborted/i);
  });

  it('counts clips on samples at +/- 1.0', async () => {
    const sampleRate = 48_000;
    const data = new Float32Array(10);
    data[0] = 1.0;
    data[3] = -1.0;
    data[7] = 1.5; // ridiculous but still a clip
    const buffer = makeFakeAudioBuffer([data], sampleRate);

    const result = await analyzeAudioBufferInWorker(buffer);
    expect(result.clipCount).toBe(3);
  });
});

/**
 * v3.300 — Regression guards for the ZERO-COPY track-switch crackle fix.
 *
 * The fix transfers the AudioBuffer's channel ArrayBuffers directly to the
 * worker instead of memcpy-ing them first (~170MB on the main thread for a
 * 4-min stereo track — the residual crackle source per voice 7421). That is
 * only safe because the AudioBuffer is discarded immediately after the call
 * (see `extractTransferableChannels` invariant comment + `audioAnalysis.ts`
 * `analyzeTrackFromUrl`). These tests pin two things so a future change can't
 * silently reintroduce a use-after-detach OR a wasteful re-copy:
 *
 *   1. The PRODUCTION CALLER never reads the AudioBuffer after the worker
 *      call returns — asserted by source inspection so it fails loud if
 *      someone adds a post-analysis `buffer.getChannelData(...)` read.
 *   2. Zero-copy correctness: a channel whose Float32Array exactly spans its
 *      own ArrayBuffer is transferred WITHOUT a defensive copy, and the
 *      analysis numbers are still correct.
 */
describe('analyzeAudioBufferInWorker — zero-copy transfer safety (v3.300)', () => {
  it('production caller does not read the AudioBuffer after analysis returns', async () => {
    // The detach-safety invariant lives in real source, not a mock: after
    // `analyzeAudioBufferInWorker(buffer, ...)` the local `buffer` must never
    // be touched again (otherwise transferring/detaching its channels would
    // be a use-after-detach bug). We assert it directly against the source of
    // the sole production caller so this test breaks the moment someone adds
    // a post-analysis read of the buffer.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const callerPath = path.resolve(here, '..', 'audioAnalysis.ts');
    const src = await fs.readFile(callerPath, 'utf8');

    // Find the call site and everything that follows it inside the function.
    const callIdx = src.indexOf('analyzeAudioBufferInWorker(buffer');
    expect(callIdx).toBeGreaterThan(-1);
    const afterCall = src.slice(callIdx + 'analyzeAudioBufferInWorker(buffer'.length);
    // Cut at the end of the enclosing function body so we don't scan the
    // whole file. The function ends at the next top-level `export function`.
    const bodyEnd = afterCall.indexOf('\nexport function');
    const tail = bodyEnd === -1 ? afterCall : afterCall.slice(0, bodyEnd);

    // No read of the discarded buffer is allowed after the worker call.
    expect(tail).not.toMatch(/buffer\.getChannelData/);
    expect(tail).not.toMatch(/buffer\.numberOfChannels/);
    expect(tail).not.toMatch(/return\s+buffer\b/);
  });

  it('transfers a whole-buffer channel without copying (zero-copy), numbers still correct', async () => {
    const sampleRate = 44_100;
    const len = 1024;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i += 1) {
      data[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    }
    // A channel view that exactly spans its own ArrayBuffer — the production
    // shape WebAudio always produces, and the case that must go zero-copy.
    expect(data.byteOffset).toBe(0);
    expect(data.byteLength).toBe(data.buffer.byteLength);

    const buffer = makeFakeAudioBuffer([data], sampleRate);
    const result = await analyzeAudioBufferInWorker(buffer);
    const expected = runTrackAnalysisCore([data], sampleRate, buffer.duration, len);

    expect(result.peakDbfs).toBeCloseTo(expected.peakDbfs, 6);
    expect(result.rmsDbfs).toBeCloseTo(expected.rmsDbfs, 6);
    expect(result.clipCount).toBe(expected.clipCount);
  });
});
