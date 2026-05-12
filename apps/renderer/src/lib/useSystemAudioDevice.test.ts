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
    expect(result).toEqual({ deviceId: '', label: '' });
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
    expect(result).toEqual({ deviceId: '', label: '' });
  });

  it('resolves the default output via the "default" entry groupId', async () => {
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
    expect(result.deviceId).toBe('group-airpods');
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
    expect(result.deviceId).toBe('group-speakers');
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
    expect(result.deviceId).toBe('group-x');
    expect(result.label).toBe('');
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
    expect(result).toEqual({ deviceId: '', label: '' });
  });
});
