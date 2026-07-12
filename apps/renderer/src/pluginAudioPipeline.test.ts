import { describe, expect, it } from 'vitest';
import {
  applyGainInPlace,
  base64ToFloat32Interleaved,
  clampPluginSlotGainLinear,
  float32InterleavedToBase64,
  getEnabledPluginProcessChain,
  getPluginSlotInputGain,
  getPluginSlotOutputGain,
  interleaveStereoSamples,
  PluginAudioOutputTimeline,
  shouldWaitForPluginNativePrewarm,
  writeInterleavedStereoSamples,
} from './pluginAudioPipeline';
import type { TrackPluginChain } from '@producer-player/contracts';

describe('pluginAudioPipeline', () => {
  it('builds an ordered enabled processing chain for mix plugins', () => {
    const chain: TrackPluginChain = {
      songId: 'song-a',
      items: [
        { instanceId: 'third', pluginId: 'vst3:c', enabled: true, order: 2 },
        { instanceId: 'disabled', pluginId: 'vst3:b', enabled: false, order: 1 },
        { instanceId: 'first', pluginId: 'vst3:a', enabled: true, order: 0 },
        { instanceId: 'loading', pluginId: 'vst3:d', enabled: true, order: 3 },
      ],
    };

    expect(
      getEnabledPluginProcessChain(chain, new Set(['first', 'third'])),
    ).toEqual([
      { instanceId: 'first', enabled: true },
      { instanceId: 'third', enabled: true },
      { instanceId: 'loading', enabled: true },
    ]);

    expect(
      getEnabledPluginProcessChain(chain, new Set(['first', 'third']), {
        requireLoaded: true,
      }),
    ).toEqual([
      { instanceId: 'first', enabled: true },
      { instanceId: 'third', enabled: true },
    ]);
  });

  it('bypasses the plugin chain during reference playback', () => {
    const chain: TrackPluginChain = {
      songId: 'song-a',
      items: [{ instanceId: 'slot', pluginId: 'vst3:a', enabled: true, order: 0 }],
    };

    expect(
      getEnabledPluginProcessChain(chain, new Set(['slot']), { referencePlayback: true }),
    ).toEqual([]);
  });

  it('clamps per-plugin input/output gain to [0, 2] with NaN → unity', () => {
    expect(clampPluginSlotGainLinear(undefined)).toBe(1);
    expect(clampPluginSlotGainLinear(Number.NaN)).toBe(1);
    expect(clampPluginSlotGainLinear(-1)).toBe(0);
    expect(clampPluginSlotGainLinear(0)).toBe(0);
    expect(clampPluginSlotGainLinear(1)).toBe(1);
    expect(clampPluginSlotGainLinear(1.5)).toBe(1.5);
    expect(clampPluginSlotGainLinear(3)).toBe(2);
  });

  it('reads per-slot input/output gain with sensible unity defaults', () => {
    const bare = { instanceId: 'a', pluginId: 'vst3:x', enabled: true, order: 0 } as const;
    expect(getPluginSlotInputGain(bare)).toBe(1);
    expect(getPluginSlotOutputGain(bare)).toBe(1);

    const withGains = {
      ...bare,
      inputGainLinear: 0.5,
      outputGainLinear: 1.75,
    };
    expect(getPluginSlotInputGain(withGains)).toBe(0.5);
    expect(getPluginSlotOutputGain(withGains)).toBe(1.75);

    const overdriven = { ...bare, inputGainLinear: 5, outputGainLinear: -2 };
    expect(getPluginSlotInputGain(overdriven)).toBe(2);
    expect(getPluginSlotOutputGain(overdriven)).toBe(0);
  });

  it('applyGainInPlace scales a float32 buffer and short-circuits at unity', () => {
    const buf = new Float32Array([0.5, -0.25, 1, -1]);
    applyGainInPlace(buf, 1);
    expect(Array.from(buf)).toEqual([0.5, -0.25, 1, -1]);

    applyGainInPlace(buf, 0.5);
    expect(Array.from(buf)).toEqual([0.25, -0.125, 0.5, -0.5]);

    applyGainInPlace(buf, 0);
    // Use Math.abs to collapse +0/-0 from sign-preserving multiplication.
    expect(Array.from(buf).map((v) => Math.abs(v))).toEqual([0, 0, 0, 0]);
  });

  it('round-trips stereo float32 blocks through base64', () => {
    const interleaved = interleaveStereoSamples(
      new Float32Array([0.25, -0.5]),
      new Float32Array([1, -1]),
      2,
    );

    expect(Array.from(interleaved)).toEqual([0.25, 1, -0.5, -1]);

    const decoded = base64ToFloat32Interleaved(float32InterleavedToBase64(interleaved));
    expect(Array.from(decoded)).toEqual(Array.from(interleaved));

    const outL = new Float32Array(2);
    const outR = new Float32Array(2);
    expect(writeInterleavedStereoSamples(decoded, outL, outR, 2)).toBe(true);
    expect(Array.from(outL)).toEqual([0.25, -0.5]);
    expect(Array.from(outR)).toEqual([1, -1]);
  });

  it('never emits a late processed block during a later callback', () => {
    const timeline = new PluginAudioOutputTimeline(2);
    const first = timeline.enqueue({
      generation: 1,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([1, 1]),
    });
    timeline.enqueue({
      generation: 1,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([2, 2]),
    });
    timeline.enqueue({
      generation: 1,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([3, 3]),
    });

    const output = timeline.takeOutput();
    expect(output?.sequence).toBe(first.sequence);
    expect(output?.usedProcessedAudio).toBe(false);
    expect(Array.from(output?.samples ?? [])).toEqual([1, 1]);

    expect(
      timeline.attachProcessed({
        sequence: first.sequence,
        generation: 1,
        samples: new Float32Array([99, 99]),
      }),
    ).toBe(false);

    timeline.enqueue({
      generation: 1,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([4, 4]),
    });
    expect(Array.from(timeline.takeOutput()?.samples ?? [])).toEqual([2, 2]);
  });

  it('uses a processed reply only for its matching sequence and generation', () => {
    const timeline = new PluginAudioOutputTimeline(1);
    const first = timeline.enqueue({
      generation: 7,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([1, 1]),
    });
    timeline.enqueue({
      generation: 8,
      expectsProcessedAudio: false,
      drySamples: new Float32Array([2, 2]),
    });

    expect(
      timeline.attachProcessed({
        sequence: first.sequence,
        generation: 8,
        samples: new Float32Array([8, 8]),
      }),
    ).toBe(false);
    expect(
      timeline.attachProcessed({
        sequence: first.sequence,
        generation: 7,
        samples: new Float32Array([7, 7]),
      }),
    ).toBe(true);

    const output = timeline.takeOutput();
    expect(output?.generation).toBe(7);
    expect(output?.usedProcessedAudio).toBe(true);
    expect(Array.from(output?.samples ?? [])).toEqual([7, 7]);
  });

  it('rejects a processed reply that cannot fill its matching output block', () => {
    const timeline = new PluginAudioOutputTimeline(1);
    const first = timeline.enqueue({
      generation: 9,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([1, 1, 1, 1]),
    });
    timeline.enqueue({
      generation: 9,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([2, 2, 2, 2]),
    });
    expect(
      timeline.attachProcessed({
        sequence: first.sequence,
        generation: 9,
        samples: new Float32Array([9, 9]),
      }),
    ).toBe(false);
    expect(Array.from(timeline.takeOutput()?.samples ?? [])).toEqual([1, 1, 1, 1]);
  });

  it('keeps album handoff generations in source order', () => {
    const timeline = new PluginAudioOutputTimeline(1);
    timeline.enqueue({
      generation: 20,
      expectsProcessedAudio: false,
      drySamples: new Float32Array([20, 20]),
    });
    timeline.enqueue({
      generation: 21,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([21, 21]),
    });
    expect(timeline.takeOutput()?.generation).toBe(20);
    timeline.enqueue({
      generation: 21,
      expectsProcessedAudio: true,
      drySamples: new Float32Array([22, 22]),
    });
    expect(timeline.takeOutput()?.generation).toBe(21);
  });

  it('preserves the exact block count and boundary across an album handoff', () => {
    const timeline = new PluginAudioOutputTimeline(2);
    const outputs: Array<{ generation: number; samples: number[] }> = [];
    const enqueueAndTake = (options: {
      generation: number;
      expectsProcessedAudio: boolean;
      dry: number;
      processed?: number;
    }): void => {
      const block = timeline.enqueue({
        generation: options.generation,
        expectsProcessedAudio: options.expectsProcessedAudio,
        drySamples: new Float32Array([options.dry, options.dry]),
      });
      if (options.processed !== undefined) {
        timeline.attachProcessed({
          sequence: block.sequence,
          generation: options.generation,
          samples: new Float32Array([options.processed, options.processed]),
        });
      }
      const output = timeline.takeOutput();
      if (output) {
        outputs.push({
          generation: output.generation,
          samples: Array.from(output.samples),
        });
      }
    };

    // Two dry blocks from track A followed by two wet blocks from track B.
    enqueueAndTake({ generation: 1, expectsProcessedAudio: false, dry: 10 });
    enqueueAndTake({ generation: 1, expectsProcessedAudio: false, dry: 11 });
    enqueueAndTake({ generation: 2, expectsProcessedAudio: true, dry: 20, processed: 120 });
    enqueueAndTake({ generation: 2, expectsProcessedAudio: true, dry: 21, processed: 121 });
    // Silent successor blocks drain the fixed latency without changing the
    // duration or ownership of either album track.
    enqueueAndTake({ generation: 3, expectsProcessedAudio: false, dry: 0 });
    enqueueAndTake({ generation: 3, expectsProcessedAudio: false, dry: 0 });

    expect(outputs).toEqual([
      { generation: 1, samples: [10, 10] },
      { generation: 1, samples: [11, 11] },
      { generation: 2, samples: [120, 120] },
      { generation: 2, samples: [121, 121] },
    ]);
  });

  it('waits only for the current song\'s audible plug-in prewarm', () => {
    expect(
      shouldWaitForPluginNativePrewarm({
        audioPaused: true,
        playbackSongId: 'normal-song',
        prewarmSongId: 'plugin-song',
        prewarmRequiredForPlayback: true,
      }),
    ).toBe(false);
    expect(
      shouldWaitForPluginNativePrewarm({
        audioPaused: true,
        playbackSongId: 'plugin-song',
        prewarmSongId: 'plugin-song',
        prewarmRequiredForPlayback: true,
      }),
    ).toBe(true);
    expect(
      shouldWaitForPluginNativePrewarm({
        audioPaused: true,
        playbackSongId: 'plugin-song',
        prewarmSongId: 'plugin-song',
        prewarmRequiredForPlayback: false,
      }),
    ).toBe(false);
    expect(
      shouldWaitForPluginNativePrewarm({
        audioPaused: false,
        playbackSongId: 'plugin-song',
        prewarmSongId: 'plugin-song',
        prewarmRequiredForPlayback: true,
      }),
    ).toBe(false);
  });
});
