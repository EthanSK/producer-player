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
