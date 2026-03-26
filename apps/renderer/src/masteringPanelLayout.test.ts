import { describe, expect, it } from 'vitest';
import {
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
