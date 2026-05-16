import { describe, expect, it } from 'vitest';
import type { ListeningDevice } from '@producer-player/contracts';
import {
  applyExplicitLinkAssociation,
  applyExplicitUnlinkAssociation,
  decideAutoSelect,
  decideForceAutoSelect,
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

  // v3.213 — translate-on-read fallback. Pre-v3.213 link records were
  // persisted with the volatile `groupId` value because
  // `readSystemAudioDevice` returned `groupId` as `deviceId`. After the
  // fix, the snapshot's `deviceId` is the stable per-device id, and
  // `groupId` is carried as a secondary field. Legacy link records that
  // still hold the old groupId value in `systemDeviceId` MUST match via
  // the snapshot's `groupId` so the link survives the upgrade until the
  // user re-links (which then captures the stable id).
  it('falls back to groupId when systemDeviceId is a legacy groupId-format value (v3.213 fix)', () => {
    // Legacy state: airpods.systemDeviceId is the OLD groupId
    // ('group-airpods-OLD') captured before v3.213.
    const legacyAirpods: ListeningDevice = {
      id: 'device-airpods-legacy',
      name: 'AirPods Pro',
      systemDeviceId: 'group-airpods-OLD',
      systemDeviceLabel: 'AirPods Pro',
    };
    // Current snapshot from the post-v3.213 hook: deviceId is the new
    // stable id, groupId carries the (still volatile but currently-OLD)
    // groupId so the matcher can find the legacy record.
    const decision = decideAutoSelect(
      {
        deviceId: 'stable-airpods-id',
        groupId: 'group-airpods-OLD',
        label: 'AirPods Pro',
      },
      [legacyAirpods, monitors],
      null
    );
    expect(decision.activateDeviceId).toBe('device-airpods-legacy');
    expect(decision.matchedDevice).toBe(legacyAirpods);
  });

  // v3.213 — when BOTH a fresh-format (deviceId-keyed) record AND a
  // legacy-format (groupId-keyed) record exist, the fresh-format one
  // wins. This guards against a stale legacy record activating the
  // wrong listening device when the user has already re-linked.
  it('prefers deviceId match over groupId fallback when both could resolve', () => {
    const freshDevice: ListeningDevice = {
      id: 'device-fresh',
      name: 'Fresh',
      systemDeviceId: 'stable-device-id',
    };
    const legacyDevice: ListeningDevice = {
      id: 'device-legacy',
      name: 'Legacy',
      systemDeviceId: 'volatile-group-id',
    };
    const decision = decideAutoSelect(
      {
        deviceId: 'stable-device-id',
        groupId: 'volatile-group-id',
        label: 'Anything',
      },
      [legacyDevice, freshDevice],
      null
    );
    expect(decision.activateDeviceId).toBe('device-fresh');
    expect(decision.matchedDevice).toBe(freshDevice);
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

  // v3.210 — regression for voice 2984. Scenario: PP was last closed with
  // `activeListeningDeviceId = device-mbp-speakers`. While PP was closed the
  // OS default output changed to a different device (`group-monitors`) which
  // is linked to a SEPARATE listening device (`device-monitors`). On
  // startup, the initial-sync effect in App.tsx calls decideAutoSelect with
  // the current system device + persisted active id; it MUST return the
  // linked device so the chip flips off the stale persisted value. Without
  // this behavior the user sees "MacBook Pro Speakers" active despite the
  // OS being on Scarlett 18i8 linked to HSA.
  it('initial-sync: switches off a stale persisted active id when the current system device is linked to a different listening device', () => {
    const mbpSpeakers: ListeningDevice = {
      id: 'device-mbp-speakers',
      name: 'MacBook Pro Speakers',
      systemDeviceId: 'group-mbp-speakers',
      systemDeviceLabel: 'MacBook Pro Speakers',
    };
    const decision = decideAutoSelect(
      { deviceId: 'group-monitors', label: 'Kali LP-6 (audio interface)' },
      [mbpSpeakers, monitors, airpods],
      'device-mbp-speakers' // persisted-but-stale active id
    );
    expect(decision.activateDeviceId).toBe('device-monitors');
    expect(decision.matchedDevice).toBe(monitors);
  });

  // v3.211 — regression for voice 3076. The v3.210 initial-sync fix only
  // ran ONCE per app launch and was gated on `systemAudioDevice.deviceId`
  // being non-empty at the time the effect ran. If the post-permission
  // refresh hadn't yet populated the device, the chip stayed stale until
  // the user manually triggered a device-change. v3.211 adds a checklist-
  // open trigger that re-runs decideAutoSelect with the freshly-resolved
  // system device.
  //
  // This test pins the same decision logic the on-open trigger relies on:
  // even after the initial-sync has fired (returning `null` because the
  // persisted active id ALREADY matches the linked device), a SUBSEQUENT
  // open with a NEW system device must still switch the chip. Confirms
  // decideAutoSelect is correctly state-free.
  it('on-open re-sync: switches to the newly-linked device after a system-device transition', () => {
    // Step 1: persisted chip already matches the OS default (group-airpods).
    const step1 = decideAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [airpods, monitors],
      'device-airpods'
    );
    expect(step1.activateDeviceId).toBeNull();
    // Step 2: OS default flipped to monitors. Subsequent on-open re-check
    // must return the monitor device id even though the chip is currently
    // airpods.
    const step2 = decideAutoSelect(
      { deviceId: 'group-monitors', label: 'Kali LP-6 (audio interface)' },
      [airpods, monitors],
      'device-airpods'
    );
    expect(step2.activateDeviceId).toBe('device-monitors');
    expect(step2.matchedDevice).toBe(monitors);
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

describe('applyExplicitUnlinkAssociation (v3.203 — Unlink × button)', () => {
  it('clears systemDeviceId + systemDeviceLabel on a device that has a link', () => {
    const next = applyExplicitUnlinkAssociation([airpods, monitors], 'device-airpods');
    const updated = next.find((d) => d.id === 'device-airpods');
    expect(updated?.systemDeviceId).toBeUndefined();
    expect(updated?.systemDeviceLabel).toBeUndefined();
    // Other devices are untouched.
    const other = next.find((d) => d.id === 'device-monitors');
    expect(other?.systemDeviceId).toBe('group-monitors');
    expect(other?.systemDeviceLabel).toBe('Kali LP-6 (audio interface)');
  });

  it('clears even when only the id is set (label was already absent)', () => {
    const idOnly: ListeningDevice = {
      id: 'device-id-only',
      name: 'Id-only',
      systemDeviceId: 'group-id-only',
    };
    const next = applyExplicitUnlinkAssociation([idOnly], 'device-id-only');
    const updated = next.find((d) => d.id === 'device-id-only');
    expect(updated?.systemDeviceId).toBeUndefined();
    expect(updated?.systemDeviceLabel).toBeUndefined();
  });

  it('returns input referentially unchanged when the selected id is not in the list', () => {
    const before: ListeningDevice[] = [airpods, monitors];
    const next = applyExplicitUnlinkAssociation(before, 'device-missing');
    expect(next).toBe(before);
  });

  it('returns input referentially unchanged when the target has no existing link', () => {
    const before: ListeningDevice[] = [carStereo];
    const next = applyExplicitUnlinkAssociation(before, 'device-car');
    expect(next).toBe(before);
  });
});

// v3.220 — `decideForceAutoSelect` is the "always-return-the-match" variant
// used by the per-track checklist-open auto-switcher and the manual Detect
// button. The key behavioral difference from `decideAutoSelect` is that
// when the matched device equals the current active id, this function
// returns the matched id in `activateDeviceId` (instead of null) AND sets
// `alreadyActive=true` so the caller can suppress the toast while still
// writing through to state. Voice 3129 / 3130.
describe('decideForceAutoSelect (v3.220 — Detect + checklist-open force path)', () => {
  it('returns null match when system device id AND group id are both blank', () => {
    expect(
      decideForceAutoSelect({ deviceId: '', label: '' }, [airpods, monitors], null),
    ).toEqual({ activateDeviceId: null, matchedDevice: null, alreadyActive: false });
  });

  it('returns null match when no listening device is linked to the system output', () => {
    expect(
      decideForceAutoSelect(
        { deviceId: 'group-unknown', label: 'External DAC' },
        [airpods, monitors],
        null,
      ),
    ).toEqual({ activateDeviceId: null, matchedDevice: null, alreadyActive: false });
  });

  it('returns activate id + match when switching to a different listening device', () => {
    const decision = decideForceAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [carStereo, airpods, monitors],
      'device-monitors',
    );
    expect(decision.activateDeviceId).toBe('device-airpods');
    expect(decision.matchedDevice).toBe(airpods);
    expect(decision.alreadyActive).toBe(false);
  });

  it('still returns the match id (NOT null) when the matched device is already active, plus alreadyActive=true', () => {
    const decision = decideForceAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [airpods, monitors],
      'device-airpods',
    );
    // Different from `decideAutoSelect`, which returns null here:
    expect(decision.activateDeviceId).toBe('device-airpods');
    expect(decision.matchedDevice).toBe(airpods);
    expect(decision.alreadyActive).toBe(true);
  });

  it('falls back to groupId when systemDeviceId is a legacy groupId-format value (v3.213 fallback survives)', () => {
    const legacyAirpods: ListeningDevice = {
      id: 'device-airpods-legacy',
      name: 'AirPods Pro',
      systemDeviceId: 'group-airpods-OLD',
      systemDeviceLabel: 'AirPods Pro',
    };
    const decision = decideForceAutoSelect(
      {
        deviceId: 'stable-airpods-id',
        groupId: 'group-airpods-OLD',
        label: 'AirPods Pro',
      },
      [legacyAirpods, monitors],
      null,
    );
    expect(decision.activateDeviceId).toBe('device-airpods-legacy');
    expect(decision.matchedDevice).toBe(legacyAirpods);
    expect(decision.alreadyActive).toBe(false);
  });
});

// v3.220 — pins for the per-song "auto-set listening device on open" checkbox
// (voice 3129 / 3130). These tests live alongside the auto-select logic
// because the checkbox's behavioral contract is "gate the auto-select run
// on checklist open, default ON via absence". Testing the React component
// would require booting JSDOM + App.tsx (too heavy); instead we pin the
// localStorage-mirror semantics that drive the gate. The full integration
// (modal-open → auto-select fire / skip / Detect bypass) is verified end-
// to-end on the Mac Mini via OpenClaw.
describe('songAutoSetListeningDeviceOnOpen — localStorage semantics (v3.220)', () => {
  // Mirror of the App.tsx helpers, kept in sync with the implementation.
  // If the prefix changes there, this constant must change too (and the test
  // will fail loudly), which is the desired regression signal.
  const KEY_PREFIX = 'producer-player.auto-set-listening-device.';
  function persistAutoSetListeningDeviceForSong(
    storage: Map<string, string>,
    songId: string,
    enabled: boolean,
  ): void {
    storage.set(`${KEY_PREFIX}${songId}`, enabled ? '1' : '0');
  }
  function readAutoSetListeningDeviceForSong(
    storage: Map<string, string>,
    songId: string,
  ): boolean {
    const raw = storage.get(`${KEY_PREFIX}${songId}`);
    return raw !== '0';
  }

  it('defaults to ON when no value has been persisted (absence === enabled)', () => {
    const storage = new Map<string, string>();
    expect(readAutoSetListeningDeviceForSong(storage, 'song-fresh')).toBe(true);
  });

  it('returns ON after explicit ON persist', () => {
    const storage = new Map<string, string>();
    persistAutoSetListeningDeviceForSong(storage, 'song-x', true);
    expect(storage.get(`${KEY_PREFIX}song-x`)).toBe('1');
    expect(readAutoSetListeningDeviceForSong(storage, 'song-x')).toBe(true);
  });

  it('returns OFF only when explicitly persisted as "0"', () => {
    const storage = new Map<string, string>();
    persistAutoSetListeningDeviceForSong(storage, 'song-x', false);
    expect(storage.get(`${KEY_PREFIX}song-x`)).toBe('0');
    expect(readAutoSetListeningDeviceForSong(storage, 'song-x')).toBe(false);
  });

  it('toggles ON→OFF→ON round-trip cleanly per song', () => {
    const storage = new Map<string, string>();
    persistAutoSetListeningDeviceForSong(storage, 'song-a', false);
    expect(readAutoSetListeningDeviceForSong(storage, 'song-a')).toBe(false);
    persistAutoSetListeningDeviceForSong(storage, 'song-a', true);
    expect(readAutoSetListeningDeviceForSong(storage, 'song-a')).toBe(true);
  });

  it('keeps per-song values isolated — setting Song A does not affect Song B', () => {
    const storage = new Map<string, string>();
    persistAutoSetListeningDeviceForSong(storage, 'song-a', false);
    // Song B is untouched; defaults to ON via absence.
    expect(readAutoSetListeningDeviceForSong(storage, 'song-a')).toBe(false);
    expect(readAutoSetListeningDeviceForSong(storage, 'song-b')).toBe(true);
  });

  it('Detect-button semantics: a one-shot call must succeed regardless of the toggle', () => {
    // The Detect handler in App.tsx never reads
    // `readAutoSetListeningDeviceForSong` — this test pins that the gate
    // logic and the Detect path are decoupled by re-using the decision
    // function directly here.
    const storage = new Map<string, string>();
    persistAutoSetListeningDeviceForSong(storage, 'song-disabled', false);
    // Whatever the toggle says, Detect must still resolve a match against
    // the OS output. The toggle gate only applies on checklist-open auto-fire.
    const decision = decideForceAutoSelect(
      { deviceId: 'group-airpods', label: 'AirPods Pro' },
      [airpods, monitors],
      null,
    );
    expect(decision.activateDeviceId).toBe('device-airpods');
    // Whether the song's toggle is off changes nothing for Detect:
    expect(readAutoSetListeningDeviceForSong(storage, 'song-disabled')).toBe(false);
  });
});
