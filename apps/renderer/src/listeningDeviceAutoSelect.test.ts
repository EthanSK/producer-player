import { describe, expect, it } from 'vitest';
import type { ListeningDevice } from '@producer-player/contracts';
import {
  applyExplicitLinkAssociation,
  decideAutoSelect,
} from './listeningDeviceAutoSelect';

const airpods: ListeningDevice = {
  id: 'device-airpods',
  name: 'AirPods Pro',
  systemDeviceId: 'group-airpods',
  systemDeviceLabel: 'AirPods Pro',
};

const monitors: ListeningDevice = {
  id: 'device-monitors',
  name: 'Kali LP-6',
  systemDeviceId: 'group-monitors',
  systemDeviceLabel: 'Kali LP-6 (audio interface)',
};

const carStereo: ListeningDevice = {
  id: 'device-car',
  name: 'Car stereo',
  // intentionally no system association
};

describe('decideAutoSelect', () => {
  it('returns null when the system device id is blank', () => {
    expect(
      decideAutoSelect({ deviceId: '', label: '' }, [airpods, monitors], null)
    ).toEqual({ activateDeviceId: null, matchedDevice: null });
  });

  it('returns null when no listening device matches the new system device', () => {
    expect(
      decideAutoSelect(
        { deviceId: 'group-unknown', label: 'External DAC' },
        [airpods, monitors],
        null
      )
    ).toEqual({ activateDeviceId: null, matchedDevice: null });
  });

  it('activates the matching listening device when the system default changes', () => {
    const decision = decideAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [carStereo, airpods, monitors],
      'device-monitors'
    );
    expect(decision.activateDeviceId).toBe('device-airpods');
    expect(decision.matchedDevice).toBe(airpods);
  });

  it('returns null when the matched device is already active (no redundant switch)', () => {
    const decision = decideAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [airpods, monitors],
      'device-airpods'
    );
    expect(decision.activateDeviceId).toBeNull();
    expect(decision.matchedDevice).toBe(airpods);
  });

  it('ignores listening devices whose systemDeviceId is an empty string', () => {
    const ghost: ListeningDevice = {
      id: 'device-ghost',
      name: 'Ghost',
      systemDeviceId: '',
    };
    expect(
      decideAutoSelect({ deviceId: '', label: '' }, [ghost], null)
    ).toEqual({ activateDeviceId: null, matchedDevice: null });
  });

  it('matches the first listening device when more than one shares a systemDeviceId', () => {
    const duplicate: ListeningDevice = {
      id: 'device-airpods-2',
      name: 'AirPods Pro (also)',
      systemDeviceId: 'group-airpods',
    };
    const decision = decideAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [airpods, duplicate],
      null
    );
    expect(decision.activateDeviceId).toBe('device-airpods');
  });
});

describe('applyExplicitLinkAssociation (v3.197 — Link button)', () => {
  it('captures system device id + label on a device with no existing link', () => {
    const next = applyExplicitLinkAssociation(
      [carStereo],
      'device-car',
      { deviceId: 'group-car-bt', label: 'Mazda CX-5 Bluetooth' }
    );
    const updated = next.find((d) => d.id === 'device-car');
    expect(updated?.systemDeviceId).toBe('group-car-bt');
    expect(updated?.systemDeviceLabel).toBe('Mazda CX-5 Bluetooth');
  });

  it('overwrites an existing link (re-link behavior)', () => {
    const before: ListeningDevice[] = [airpods];
    const next = applyExplicitLinkAssociation(before, 'device-airpods', {
      deviceId: 'group-monitors',
      label: 'Kali LP-6 (audio interface)',
    });
    expect(next).not.toBe(before);
    const updated = next.find((d) => d.id === 'device-airpods');
    expect(updated?.systemDeviceId).toBe('group-monitors');
    expect(updated?.systemDeviceLabel).toBe('Kali LP-6 (audio interface)');
  });

  it('does nothing when the selected id is not in the list', () => {
    const before: ListeningDevice[] = [airpods, carStereo];
    const next = applyExplicitLinkAssociation(before, 'device-missing', {
      deviceId: 'group-x',
      label: 'X',
    });
    expect(next).toBe(before);
  });

  it('does nothing when the current system device is blank', () => {
    const before: ListeningDevice[] = [carStereo];
    const next = applyExplicitLinkAssociation(before, 'device-car', {
      deviceId: '',
      label: '',
    });
    expect(next).toBe(before);
  });

  it('captures id only and clears any stale label when snapshot label is blank', () => {
    // Pre-condition: airpods has a label. Re-link to a device whose label
    // didn't resolve — old label should be cleared so the UI doesn't
    // misrepresent the new association.
    const next = applyExplicitLinkAssociation(
      [airpods],
      'device-airpods',
      { deviceId: 'group-new', label: '' }
    );
    const updated = next.find((d) => d.id === 'device-airpods');
    expect(updated?.systemDeviceId).toBe('group-new');
    expect(updated?.systemDeviceLabel).toBeUndefined();
  });

  it('returns input unchanged when the target has no existing label and link cannot resolve a new one', () => {
    const next = applyExplicitLinkAssociation(
      [carStereo],
      'device-car',
      { deviceId: 'group-x', label: '' }
    );
    const updated = next.find((d) => d.id === 'device-car');
    expect(updated?.systemDeviceId).toBe('group-x');
    expect(updated?.systemDeviceLabel).toBeUndefined();
  });
});
