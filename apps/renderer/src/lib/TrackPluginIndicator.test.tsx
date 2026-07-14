import { describe, expect, it } from 'vitest';
import type { ScannedPluginLibrary, TrackPluginChain } from '@producer-player/contracts';
import { getTrackPluginDisplayModel } from './TrackPluginIndicator';

const library: ScannedPluginLibrary = {
  scannedAt: '2026-07-14T00:00:00.000Z',
  scanVersion: 1,
  plugins: [
    {
      id: 'au:limiter',
      name: 'Limiter',
      vendor: 'Test Labs',
      format: 'au',
      version: '1.0',
      path: '/Library/Audio/Plug-Ins/Components/Limiter.component',
      categories: ['Dynamics'],
      isSupported: true,
      failureReason: null,
    },
    {
      id: 'vst3:broken',
      name: 'Broken EQ',
      vendor: 'Test Labs',
      format: 'vst3',
      version: '1.0',
      path: '/Library/Audio/Plug-Ins/VST3/Broken.vst3',
      categories: ['EQ'],
      isSupported: false,
      failureReason: 'Failed scan',
    },
  ],
};

function makeChain(items: TrackPluginChain['items']): TrackPluginChain {
  return { songId: 'song-1', items };
}

describe('track plugin visibility model', () => {
  it('returns no indicator for a track with no saved plugins', () => {
    expect(getTrackPluginDisplayModel(makeChain([]), library)).toBeNull();
  });

  it('keeps enabled, bypassed, and unavailable slots visibly distinct', () => {
    const model = getTrackPluginDisplayModel(
      makeChain([
        { instanceId: 'enabled', pluginId: 'au:limiter', enabled: true, order: 0 },
        { instanceId: 'bypassed', pluginId: 'au:limiter', enabled: false, order: 1 },
        { instanceId: 'broken', pluginId: 'vst3:broken', enabled: true, order: 2 },
      ]),
      library,
    );

    expect(model).toMatchObject({
      totalCount: 3,
      enabledCount: 1,
      bypassedCount: 1,
      unavailableCount: 1,
      summary: '3 plugins: 1 enabled, 1 bypassed, 1 unavailable',
      hasAttention: true,
    });
    expect(model?.items.map((item) => item.status)).toEqual([
      'enabled',
      'bypassed',
      'unavailable',
    ]);
  });

  it('does not mislabel an unscanned saved plugin as unavailable', () => {
    const model = getTrackPluginDisplayModel(
      makeChain([
        { instanceId: 'saved', pluginId: 'au:unknown-plugin', enabled: true, order: 0 },
      ]),
      null,
    );

    expect(model).toMatchObject({
      totalCount: 1,
      enabledCount: 1,
      unavailableCount: 0,
      summary: '1 plugin: 1 enabled',
    });
    expect(model?.items[0]).toMatchObject({ name: 'unknown-plugin', formatLabel: 'FX' });
  });

  it('marks an all-bypassed chain for attention instead of looking ordinary', () => {
    const model = getTrackPluginDisplayModel(
      makeChain([
        { instanceId: 'bypassed', pluginId: 'au:limiter', enabled: false, order: 0 },
      ]),
      library,
    );

    expect(model).toMatchObject({
      enabledCount: 0,
      bypassedCount: 1,
      hasAttention: true,
    });
  });
});
