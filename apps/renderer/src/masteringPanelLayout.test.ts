import { describe, expect, it } from 'vitest';
import {
  calculateEdgeAutoScrollVelocity,
  movePanelBefore,
  persistPanelOrder,
  readPanelOrderFromStorage,
  sanitizePanelOrder,
} from './masteringPanelLayout';

describe('sanitizePanelOrder', () => {
  it('keeps valid unique IDs and appends missing defaults', () => {
    const defaults = ['a', 'b', 'c', 'd'] as const;

    const result = sanitizePanelOrder(['b', 'z', 'a', 'b', 'c'], defaults);

    expect(result).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('movePanelBefore', () => {
  it('moves dragged panel before drop target', () => {
    const result = movePanelBefore(['a', 'b', 'c', 'd'], 'd', 'b');
    expect(result).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns a copy without changing order for no-op moves', () => {
    const original = ['a', 'b', 'c'] as const;
    const result = movePanelBefore(original, 'b', 'b');
    expect(result).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(original);
  });
});

describe('calculateEdgeAutoScrollVelocity', () => {
  it('ramps upward near the top edge', () => {
    expect(
      calculateEdgeAutoScrollVelocity({
        pointerY: 110,
        containerTop: 100,
        containerBottom: 600,
        edgeThresholdPx: 100,
        maxVelocityPx: 24,
      })
    ).toBeLessThan(0);
  });

  it('ramps downward near the bottom edge', () => {
    expect(
      calculateEdgeAutoScrollVelocity({
        pointerY: 590,
        containerTop: 100,
        containerBottom: 600,
        edgeThresholdPx: 100,
        maxVelocityPx: 24,
      })
    ).toBeGreaterThan(0);
  });

  it('stays idle away from the edges', () => {
    expect(
      calculateEdgeAutoScrollVelocity({
        pointerY: 350,
        containerTop: 100,
        containerBottom: 600,
        edgeThresholdPx: 100,
        maxVelocityPx: 24,
      })
    ).toBe(0);
  });

  it('caps the threshold for short containers', () => {
    expect(
      calculateEdgeAutoScrollVelocity({
        pointerY: 145,
        containerTop: 100,
        containerBottom: 200,
        edgeThresholdPx: 100,
        maxVelocityPx: 24,
      })
    ).toBeLessThan(0);
  });
});

describe('storage helpers', () => {
  it('reads and sanitizes stored panel order', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };

    storage.setItem('layout', JSON.stringify(['b', 'x', 'a', 'a']));

    const result = readPanelOrderFromStorage('layout', ['a', 'b', 'c'] as const, storage);

    expect(result).toEqual(['b', 'a', 'c']);
  });

  it('persists panel order as JSON', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };

    persistPanelOrder('layout', ['z', 'y', 'x'], storage);

    expect(store.get('layout')).toBe('["z","y","x"]');
  });
});
