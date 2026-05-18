/// <reference lib="webworker" />

/**
 * v3.240 — Off-main-thread track analysis worker.
 *
 * Voice-note 3288 (Ethan, 2026-05-17): "When I play a track for the first
 * time, 3.238 Producer Player, it still sometimes does the glitchiness while
 * thingies are loading, while the analysis is happening. Is there a way not
 * to like do it in the background, background thread or something? Make sure
 * it works on all platforms if possible..."
 *
 * v3.237's `setTimeout(500)` deferred the analysis kick-off but the heavy JS
 * loops still ran on the renderer's main thread once they kicked in, which is
 * the same thread that drives the audio engine's high-resolution scheduling.
 * That residual main-thread contention is the lingering crackle source.
 *
 * Architecture decision: `AudioContext.decodeAudioData` is NOT exposed in
 * standard Web Workers in Chromium 134 (Electron 40). The good news is that
 * Chromium's decodeAudioData dispatches the actual codec parse + PCM-fill onto
 * an internal audio thread already; the bit of decodeAudioData that touches
 * the renderer's main thread is small. What HAS been blocking the main thread
 * for big files is OUR per-sample JavaScript loops afterwards (mono mixdown,
 * peak/RMS, tonal balance, frame loudness, DC offset, clip count, waveform
 * peaks — every one of those iterates the entire decoded PCM buffer).
 *
 * Solution: main thread does the decode, then transfers the per-channel
 * Float32Array buffers into THIS worker, which runs every heavy loop and
 * posts back the finished TrackAnalysisResult. The renderer's main thread is
 * therefore freed from O(N) sample loops during the play-start window.
 *
 * Existing pattern reference: `idealStemWorker.ts` already uses the same
 * Vite `new Worker(new URL(...), { type: 'module' })` shape, and ships in
 * every platform build. This worker follows that exact pattern so cross-
 * platform behavior (macOS, Windows, Linux Electron 40) is identical.
 */

import {
  type TrackAnalysisWorkerRequest,
  type TrackAnalysisWorkerResponse,
  runTrackAnalysisCore,
} from './trackAnalysisCore';

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<TrackAnalysisWorkerRequest>) => {
  const { id, channels, sampleRate, durationSeconds, length } = event.data;
  try {
    const channelArrays = channels.map((buf) => new Float32Array(buf));
    const core = runTrackAnalysisCore(channelArrays, sampleRate, durationSeconds, length);
    const response: TrackAnalysisWorkerResponse = {
      id,
      ok: true,
      result: {
        peakDbfs: core.peakDbfs,
        integratedLufsEstimate: core.integratedLufsEstimate,
        frameLoudnessDbfs: core.frameLoudnessDbfs,
        frameDurationSeconds: core.frameDurationSeconds,
        durationSeconds: core.durationSeconds,
        tonalBalance: core.tonalBalance,
        rmsDbfs: core.rmsDbfs,
        crestFactorDb: core.crestFactorDb,
        dcOffset: core.dcOffset,
        clipCount: core.clipCount,
        waveformPeaks: core.waveformPeaks.buffer as ArrayBuffer,
      },
    };
    ctx.postMessage(response, [core.waveformPeaks.buffer as ArrayBuffer]);
  } catch (cause: unknown) {
    const response: TrackAnalysisWorkerResponse = {
      id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    ctx.postMessage(response);
  }
};
