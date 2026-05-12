import type { ListeningDevice } from '@producer-player/contracts';

/**
 * v3.193 — pure logic for the listening-device ⇄ system-audio-output
 * association feature. Lives in its own module so it can be unit-tested
 * without booting the full App component tree.
 */

export interface SystemDeviceSnapshot {
  deviceId: string;
  label: string;
}

export interface AutoSelectDecision {
  /**
   * Id of the listening device to make active. Null when no action should
   * be taken (no matching device, or the matching device is already
   * active).
   */
  activateDeviceId: string | null;
  /**
   * Reference to the matched listening device, when one was found.
   * Provided so the caller can compose a user-facing toast without
   * re-doing the lookup.
   */
  matchedDevice: ListeningDevice | null;
}

/**
 * Decide whether the active listening device should be auto-switched in
 * response to the system audio output changing.
 *
 * Returns `{ activateDeviceId, matchedDevice }`:
 *   - `activateDeviceId` is the id to switch to, OR null when no switch is
 *     warranted.
 *   - `matchedDevice` is the matched listening device record (or null when
 *     no match) — useful for toast composition.
 *
 * Decision rules:
 *   1. Empty / blank system deviceId → no-op.
 *   2. No listening device has a `systemDeviceId` matching the new system
 *      device → no-op.
 *   3. Multiple devices match → pick the first (creation order). Ethan's
 *      intent is to associate one listening device per system device, so
 *      this is a defensive fallback rather than an expected case.
 *   4. The matched device is already active → no-op (don't trigger a
 *      redundant toast / state update).
 *   5. Otherwise → activate the matched device.
 */
export function decideAutoSelect(
  systemDevice: SystemDeviceSnapshot,
  listeningDevices: readonly ListeningDevice[],
  currentActiveListeningDeviceId: string | null
): AutoSelectDecision {
  const target = systemDevice.deviceId.trim();
  if (target.length === 0) {
    return { activateDeviceId: null, matchedDevice: null };
  }

  const match = listeningDevices.find(
    (device) =>
      typeof device.systemDeviceId === 'string' &&
      device.systemDeviceId.trim().length > 0 &&
      device.systemDeviceId === target
  );

  if (!match) {
    return { activateDeviceId: null, matchedDevice: null };
  }

  if (match.id === currentActiveListeningDeviceId) {
    return { activateDeviceId: null, matchedDevice: match };
  }

  return { activateDeviceId: match.id, matchedDevice: match };
}

/**
 * Apply (and possibly capture) the system-device association when the user
 * manually selects a listening device.
 *
 * Returns the next `listeningDevices` array. When the selected device:
 *   - already has a `systemDeviceId` → returns the input unchanged.
 *   - has no `systemDeviceId` AND the current system device is valid →
 *     captures `systemDeviceId` + `systemDeviceLabel` on the selected
 *     device and returns a new array.
 *   - has no `systemDeviceId` and the system device is empty → returns
 *     the input unchanged (nothing to capture).
 *
 * Returned array is referentially equal to the input when no change is
 * needed, so callers can do `if (next !== prev) setListeningDevices(next)`
 * without an extra deep compare.
 */
export function applyManualSelectionAssociation(
  listeningDevices: readonly ListeningDevice[],
  selectedDeviceId: string,
  systemDevice: SystemDeviceSnapshot
): ListeningDevice[] {
  const target = listeningDevices.find((d) => d.id === selectedDeviceId);
  if (!target) {
    return listeningDevices as ListeningDevice[];
  }
  const hasAssociation =
    typeof target.systemDeviceId === 'string' && target.systemDeviceId.trim().length > 0;
  if (hasAssociation) {
    return listeningDevices as ListeningDevice[];
  }
  const systemId = systemDevice.deviceId.trim();
  if (systemId.length === 0) {
    return listeningDevices as ListeningDevice[];
  }
  const systemLabel = systemDevice.label.trim();
  return listeningDevices.map((device) => {
    if (device.id !== selectedDeviceId) return device;
    const next: ListeningDevice = {
      ...device,
      systemDeviceId: systemId,
    };
    if (systemLabel.length > 0) {
      next.systemDeviceLabel = systemLabel;
    }
    return next;
  });
}
