import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSystemAudioDevice } from './useSystemAudioDevice';

type FakeMediaDeviceInfo = {
  deviceId: string;
  groupId: string;
  kind: string;
  label: string;
};

interface FakeNavigator {
  mediaDevices?: {
    enumerateDevices: () => Promise<FakeMediaDeviceInfo[]>;
    addEventListener?: (event: string, handler: () => void) => void;
    removeEventListener?: (event: string, handler: () => void) => void;
    getUserMedia?: () => Promise<unknown>;
  };
}

const originalNavigator = globalThis.navigator;

function installNavigator(fake: FakeNavigator): void {
  // vitest jsdom env has a `navigator` global; redefine it for the test.
  Object.defineProperty(globalThis, 'navigator', {
    value: fake,
    configurable: true,
    writable: true,
  });
}

describe('readSystemAudioDevice', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns empty device when navigator.mediaDevices is unavailable', async () => {
    installNavigator({ mediaDevices: undefined });
    const result = await readSystemAudioDevice();
    expect(result).toEqual({ deviceId: '', groupId: '', label: '' });
  });

  it('returns empty device when there are no audio outputs', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'mic-1', groupId: 'group-mic', kind: 'audioinput', label: 'Built-in Mic' },
        ],
      },
    });
    const result = await readSystemAudioDevice();
    expect(result).toEqual({ deviceId: '', groupId: '', label: '' });
  });

  // v3.213 — pin the persistence shape. The resolved deviceId MUST be the
  // matched non-default entry's stable deviceId (e.g. 'a2'), NOT the
  // volatile groupId. groupId is exposed as a secondary field so legacy
  // links can still match via the fallback path. Pre-v3.213 we returned
  // `groupId` as `deviceId`, which broke links across Mac Mini launches
  // because Chromium's groupId for a given physical device flipped on
  // every relaunch (E2E evidence: c2133aad... stayed stable while groupId
  // went 0fb8b3ad... → 666c8ced...).
  it('resolves the default output to the matched entry deviceId, with groupId as a secondary id (v3.213)', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'default', groupId: 'group-airpods', kind: 'audiooutput', label: 'Default - AirPods Pro' },
          { deviceId: 'a1', groupId: 'group-speakers', kind: 'audiooutput', label: 'MacBook Pro Speakers' },
          { deviceId: 'a2', groupId: 'group-airpods', kind: 'audiooutput', label: 'AirPods Pro' },
        ],
      },
    });
    const result = await readSystemAudioDevice();
    expect(result.deviceId).toBe('a2');
    expect(result.groupId).toBe('group-airpods');
    expect(result.label).toBe('AirPods Pro');
  });

  it('falls back to the first output when no "default" entry exists', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'a1', groupId: 'group-speakers', kind: 'audiooutput', label: 'External Speakers' },
        ],
      },
    });
    const result = await readSystemAudioDevice();
    // No "default" entry exists, so the lone non-default entry IS treated
    // as the default. Its own deviceId ('a1') is the stable id.
    expect(result.deviceId).toBe('a1');
    expect(result.groupId).toBe('group-speakers');
    expect(result.label).toBe('External Speakers');
  });

  it('returns empty label when permission is not granted (label is empty string)', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'default', groupId: 'group-x', kind: 'audiooutput', label: '' },
          { deviceId: 'real', groupId: 'group-x', kind: 'audiooutput', label: '' },
        ],
      },
    });
    const result = await readSystemAudioDevice();
    // Even with no labels, the matched non-default entry's deviceId is
    // still preferred over the volatile groupId.
    expect(result.deviceId).toBe('real');
    expect(result.groupId).toBe('group-x');
    expect(result.label).toBe('');
  });

  // v3.213 — when ONLY the "default" entry is surfaced (e.g. some
  // permission/sandboxing edge cases), there's no non-default entry to
  // borrow a stable deviceId from. Fall back to the resolved groupId so
  // the matcher still has something to compare; legacy link records
  // keyed by groupId will continue to work in this scenario.
  it('falls back to groupId as deviceId when no matching non-default entry exists', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'default', groupId: 'group-y', kind: 'audiooutput', label: 'Default - Something' },
        ],
      },
    });
    const result = await readSystemAudioDevice();
    expect(result.deviceId).toBe('group-y');
    expect(result.groupId).toBe('group-y');
    expect(result.label).toBe('Default - Something');
  });

  it('returns empty device when enumerateDevices throws', async () => {
    installNavigator({
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('blocked');
        },
      },
    });
    const result = await readSystemAudioDevice();
    expect(result).toEqual({ deviceId: '', groupId: '', label: '' });
  });
});
