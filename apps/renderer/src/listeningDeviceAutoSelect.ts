import type { ListeningDevice } from '@producer-player/contracts';

/**
 * v3.193 — pure logic for the listening-device ⇄ system-audio-output
 * association feature. Lives in its own module so it can be unit-tested
 * without booting the full App component tree.
 */

export interface SystemDeviceSnapshot {
  deviceId: string;
  /**
   * v3.213 — optional secondary identifier carrying the resolved Chromium
   * `groupId` for the current default audio output. The matcher falls back
   * to comparing against this value when a link record's `systemDeviceId`
   * doesn't match `deviceId` (pre-v3.213 records were keyed by groupId,
   * which is volatile across launches — see useSystemAudioDevice.ts).
   *
   * Optional so existing call sites don't have to thread it through;
   * absent groupId = no fallback comparison performed.
   */
  groupId?: string;
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
 * v3.215 — decision shape for the "force" auto-select path used by the
 * checklist-open auto-switcher and the manual Detect button.
 *
 * Unlike {@link decideAutoSelect} (which short-circuits with `activateDeviceId
 * = null` when the matched device is already active), this one ALSO returns
 * the matched device id when it equals the current active id. The caller
 * uses that to suppress the toast (`alreadyActive=true`) but the
 * `activateDeviceId` is still surfaced for callers that want to write
 * through to state unconditionally — i.e. "force select the matched device
 * even if it's already selected". Voice 3129/3130: "force it through to
 * setActiveListeningDevice (don't short-circuit on 'chip already set')".
 *
 *   - `matchedDevice === null` → no listening device matches the OS output;
 *      caller should treat as no-op (no chip change, no toast).
 *   - `matchedDevice !== null && alreadyActive === true` → matched but
 *      already active; caller writes through if forcing, but suppresses
 *      the toast.
 *   - `matchedDevice !== null && alreadyActive === false` → matched and
 *      switching; caller writes through AND shows the toast.
 */
export interface ForceAutoSelectDecision {
  activateDeviceId: string | null;
  matchedDevice: ListeningDevice | null;
  alreadyActive: boolean;
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
  const groupTarget = (systemDevice.groupId ?? '').trim();
  if (target.length === 0 && groupTarget.length === 0) {
    return { activateDeviceId: null, matchedDevice: null };
  }

  // v3.213 — match on `deviceId` first (the stable identifier post-fix).
  // Fall back to matching on `groupId` for legacy link records that were
  // persisted by pre-v3.213 builds using the volatile groupId value.
  // We never match a stored value against BOTH — first hit wins, with
  // deviceId taking precedence so a fresh post-v3.213 link is always
  // preferred over a stale legacy groupId that happens to collide.
  const findByStored = (stored: string): ListeningDevice | undefined =>
    stored.length > 0
      ? listeningDevices.find(
          (device) =>
            typeof device.systemDeviceId === 'string' &&
            device.systemDeviceId.trim() === stored
        )
      : undefined;

  const match =
    (target.length > 0 ? findByStored(target) : undefined) ??
    (groupTarget.length > 0 ? findByStored(groupTarget) : undefined);

  if (!match) {
    return { activateDeviceId: null, matchedDevice: null };
  }

  if (match.id === currentActiveListeningDeviceId) {
    return { activateDeviceId: null, matchedDevice: match };
  }

  return { activateDeviceId: match.id, matchedDevice: match };
}

/**
 * v3.215 — "force" variant used by the per-track checklist-open auto-switch
 * and the manual Detect button (voice 3129 / 3130).
 *
 * Differs from {@link decideAutoSelect} in two ways:
 *
 *   1. When the matched listening device equals the current active id, this
 *      function still returns the matched id in `activateDeviceId` (instead
 *      of null) and sets `alreadyActive=true`. Callers that want to "force
 *      through" (write to state regardless of whether the chip matches) can
 *      always read `activateDeviceId`; callers that want to suppress the
 *      toast on no-change use `alreadyActive`.
 *   2. The result is explicit about whether a toast should fire — the
 *      checklist-open path skips the toast when nothing changed but should
 *      still call the setter to defend against any drift between the chip
 *      state and the persisted active id.
 *
 * Decision rules (unchanged from `decideAutoSelect` for the no-match path):
 *   - Blank deviceId AND blank groupId → `matchedDevice=null`.
 *   - No listening device whose `systemDeviceId` matches either the snapshot
 *     `deviceId` (preferred) or `groupId` (legacy fallback) → `matchedDevice=null`.
 *   - Multiple matches → first one wins.
 *   - Otherwise → `matchedDevice = match`, `activateDeviceId = match.id`.
 *     `alreadyActive` is true iff `match.id === currentActiveListeningDeviceId`.
 */
export function decideForceAutoSelect(
  systemDevice: SystemDeviceSnapshot,
  listeningDevices: readonly ListeningDevice[],
  currentActiveListeningDeviceId: string | null,
): ForceAutoSelectDecision {
  const target = systemDevice.deviceId.trim();
  const groupTarget = (systemDevice.groupId ?? '').trim();
  if (target.length === 0 && groupTarget.length === 0) {
    return {
      activateDeviceId: null,
      matchedDevice: null,
      alreadyActive: false,
    };
  }

  const findByStored = (stored: string): ListeningDevice | undefined =>
    stored.length > 0
      ? listeningDevices.find(
          (device) =>
            typeof device.systemDeviceId === 'string' &&
            device.systemDeviceId.trim() === stored,
        )
      : undefined;

  const match =
    (target.length > 0 ? findByStored(target) : undefined) ??
    (groupTarget.length > 0 ? findByStored(groupTarget) : undefined);

  if (!match) {
    return {
      activateDeviceId: null,
      matchedDevice: null,
      alreadyActive: false,
    };
  }

  const alreadyActive = match.id === currentActiveListeningDeviceId;
  return {
    activateDeviceId: match.id,
    matchedDevice: match,
    alreadyActive,
  };
}

/**
 * v3.197 — explicit Link button handler logic. Overwrites the target
 * listening device's `systemDeviceId` + `systemDeviceLabel` with the current
 * system audio output, regardless of whether an existing association is
 * present.
 *
 * Behavior contract:
 *   - Selected id not in the list → returns input unchanged.
 *   - Current system deviceId is blank → returns input unchanged (no-op;
 *     caller should surface a "no audio device" toast).
 *   - Otherwise → returns a new array with the target updated.
 *     • `systemDeviceLabel` is written when the snapshot label is non-empty.
 *     • When the snapshot label is empty, any existing label on the device
 *       is CLEARED — the matcher only uses `systemDeviceId`, so leaving a
 *       stale "AirPods Pro" label after re-linking to studio monitors would
 *       just confuse the UI.
 *
 * Returned array is referentially equal to the input when no change is
 * needed, so callers can early-out without a deep compare.
 *
 * Replaces v3.193's `applyManualSelectionAssociation` (silent auto-bind on
 * select). The v3.193 helper was removed because the new UX is "user must
 * explicitly click Link", not "auto-capture on first selection". This
 * function is the explicit-overwrite equivalent.
 */
export function applyExplicitLinkAssociation(
  listeningDevices: readonly ListeningDevice[],
  selectedDeviceId: string,
  systemDevice: SystemDeviceSnapshot
): ListeningDevice[] {
  const target = listeningDevices.find((d) => d.id === selectedDeviceId);
  if (!target) {
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
    } else {
      delete next.systemDeviceLabel;
    }
    return next;
  });
}

/**
 * v3.203 — explicit Unlink (×) button handler logic. Clears the target
 * listening device's `systemDeviceId` + `systemDeviceLabel` entirely so it
 * returns to the "no link" state (auto-switch will never fire for it).
 *
 * Behavior contract:
 *   - Selected id not in the list → returns input unchanged (referentially
 *     equal).
 *   - Target has neither `systemDeviceId` nor `systemDeviceLabel` set →
 *     returns input unchanged (no-op; nothing to clear).
 *   - Otherwise → returns a new array with the target's `systemDeviceId`
 *     and `systemDeviceLabel` removed. The state-service "preserve only
 *     truthy keys" pattern then omits these keys from persistence.
 *
 * The companion to `applyExplicitLinkAssociation` — together they form the
 * full "manage link" surface area: link / re-link / unlink.
 */
export function applyExplicitUnlinkAssociation(
  listeningDevices: readonly ListeningDevice[],
  selectedDeviceId: string
): ListeningDevice[] {
  const target = listeningDevices.find((d) => d.id === selectedDeviceId);
  if (!target) {
    return listeningDevices as ListeningDevice[];
  }
  const hasId =
    typeof target.systemDeviceId === 'string' && target.systemDeviceId.length > 0;
  const hasLabel =
    typeof target.systemDeviceLabel === 'string' && target.systemDeviceLabel.length > 0;
  if (!hasId && !hasLabel) {
    return listeningDevices as ListeningDevice[];
  }
  return listeningDevices.map((device) => {
    if (device.id !== selectedDeviceId) return device;
    const next: ListeningDevice = { ...device };
    delete next.systemDeviceId;
    delete next.systemDeviceLabel;
    return next;
  });
}
