import { describe, expect, it } from 'vitest';
import {
  base64ToFloat32Interleaved,
  clampPluginChainOutputGainLinear,
  float32InterleavedToBase64,
  getEnabledPluginProcessChain,
  getPluginChainOutputGainLinear,
  interleaveStereoSamples,
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

  it('normalizes plugin chain output gain for the live playback gain node', () => {
    expect(getPluginChainOutputGainLinear({ songId: 'song-a', items: [] })).toBe(1);
    expect(
      getPluginChainOutputGainLinear({
        songId: 'song-a',
        outputGainLinear: 1.25,
        items: [],
      }),
    ).toBe(1.25);
    expect(clampPluginChainOutputGainLinear(-1)).toBe(0);
    expect(clampPluginChainOutputGainLinear(3)).toBe(2);
    expect(clampPluginChainOutputGainLinear(Number.NaN)).toBe(1);
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
});
