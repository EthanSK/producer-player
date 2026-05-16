import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * v3.193 — read the operating system's current default audio output device
 * via `navigator.mediaDevices.enumerateDevices()` and emit updates whenever
 * the set of audio devices changes (`devicechange` event).
 *
 * Why this exists: Producer Player lets users tag listening devices
 * ("AirPods Pro", "Kali LP-6", "car stereo") and now associates each
 * listening device with the system audio output device it was activated on.
 * When the OS default output later changes, the renderer auto-switches the
 * active listening device to the one whose system association matches.
 *
 * Mechanism:
 *   - On mount, enumerate audio outputs and identify the entry whose
 *     `deviceId === 'default'` (Chromium-style default-device alias). The
 *     `groupId` of that "default" entry matches the underlying real device,
 *     which we surface as the stable id.
 *   - Subscribe to `navigator.mediaDevices.devicechange`. When it fires,
 *     re-enumerate and emit if the resolved device changed.
 *   - macOS subtlety: changing the system default output (e.g. plugging in
 *     AirPods) does fire `devicechange` in current Chromium builds because
 *     the `default` alias's `groupId` flips. If a future Chromium regresses
 *     this, callers can opt into the optional polling fallback by passing
 *     `pollIntervalMs`.
 *
 * Labels are only populated after the page has been granted microphone
 * permission at least once (Web Audio API security model). The hook does
 * NOT prompt — callers should explicitly call `unlockSystemAudioDeviceLabels`
 * before mounting consumers that need labels.
 */

export interface SystemAudioDevice {
  /**
   * Stable identifier for the system's current default audio output.
   *
   * v3.213 — we now prefer the `deviceId` of the underlying real entry
   * (the non-"default" `audiooutput` that matches the "default" entry's
   * `groupId`). Empirical evidence from the Mac Mini (E2E run, 2026-05-15):
   * on consecutive app launches with the SAME physical device selected,
   * Chromium's `groupId` for that device CHANGES (e.g.
   * `0fb8b3ad...` → `666c8ced...`) while the entry's actual `deviceId`
   * stays stable (`c2133aad...`). Before v3.213 we persisted the volatile
   * `groupId` as the listening-device link key, so links broke on every
   * launch.
   *
   * Falls back, in order:
   *   1. matched non-default entry's `deviceId` (preferred, stable)
   *   2. the resolved `groupId` of the "default" entry (legacy fallback;
   *      kept so we can fall back when the matched entry can't be found,
   *      e.g. permission gate before labels are unlocked).
   *   3. the "default" entry's literal `deviceId` (last resort).
   *
   * Empty string when no audio outputs are visible (e.g. permission not
   * granted, no enumerate result).
   */
  deviceId: string;
  /**
   * v3.213 — secondary identifier carrying the resolved `groupId` of the
   * "default" entry. Exposed so the auto-select matcher can fall back to
   * legacy-format link data that was persisted as a `groupId` value before
   * the v3.213 fix. Pre-v3.213 link records have `systemDeviceId` set to
   * the (volatile) groupId — translate-on-read happens by trying the
   * matcher against this field when the primary `deviceId` doesn't match.
   *
   * Empty string when no audio outputs are visible.
   */
  groupId: string;
  /**
   * Human-readable name of the device (e.g. "MacBook Pro Speakers", "AirPods
   * Pro"). Empty string when labels are unavailable (permission not granted)
   * — call `unlockSystemAudioDeviceLabels()` once to unlock these.
   */
  label: string;
}

/**
 * v3.211 — hook return shape with a `refresh()` callback. Consumers call
 * `refresh()` to force a fresh `enumerateDevices` read on demand — needed
 * because Chromium does NOT emit a `devicechange` event when media
 * permission is granted, so the initial post-permission read needs to be
 * triggered explicitly. Also useful for "re-sync on UI surface open" (e.g.
 * opening the checklist modal — voice 3076).
 */
export interface SystemAudioDeviceState extends SystemAudioDevice {
  /**
   * Force a fresh `readSystemAudioDevice` call. If the resolved device
   * differs from the last emitted value, state updates and `onChange`
   * fires (with `isInitial=false` semantics — i.e. it WILL invoke
   * `onChange`). Safe to call multiple times; a no-op when nothing changed.
   */
  refresh: () => void;
}

export interface UseSystemAudioDeviceOptions {
  /**
   * Optional polling fallback. When set to a positive number, the hook
   * additionally polls `enumerateDevices` at this interval and emits when
   * the resolved device changes. Use only if you observe `devicechange`
   * failing to fire on default-output transitions (e.g. older Chromium /
   * non-mac platforms). Defaults to 0 (no polling).
   */
  pollIntervalMs?: number;
  /**
   * Called whenever the resolved system audio device changes from the
   * previous value. NOT called for the initial mount value — that's only
   * delivered via the returned state. Useful for triggering auto-select
   * side effects without coupling them to the React render cycle.
   */
  onChange?: (device: SystemAudioDevice) => void;
}

const EMPTY_DEVICE: SystemAudioDevice = { deviceId: '', groupId: '', label: '' };

/**
 * Read the current default audio output device from `enumerateDevices`.
 * Exported for unit testing. Returns the empty device when the API is
 * unavailable, throws, or there are no audio outputs.
 */
export async function readSystemAudioDevice(): Promise<SystemAudioDevice> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    return EMPTY_DEVICE;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    if (outputs.length === 0) {
      return EMPTY_DEVICE;
    }
    // Chromium exposes a `deviceId === 'default'` entry whose `groupId` is
    // the real underlying device's group. Use that groupId to find the
    // matching non-default audio output entry — its `deviceId` is the
    // stable identifier across sessions (v3.213 bug fix; pre-v3.213 we
    // persisted the volatile `groupId` instead and links broke on restart).
    const defaultEntry = outputs.find((d) => d.deviceId === 'default') ?? outputs[0];
    const resolvedGroupId = defaultEntry.groupId;
    // The `default` entry's own label is usually "Default - <name>". Prefer
    // the matching non-default entry's clean label when we can resolve it
    // via groupId. Otherwise fall back to the default entry's label.
    const match = outputs.find(
      (d) => d.deviceId !== 'default' && d.groupId === resolvedGroupId
    );
    const label = (match?.label ?? defaultEntry.label ?? '').trim();
    // Prefer the matched non-default entry's `deviceId` (stable). Fall
    // back to the resolved groupId only when no match exists (e.g.
    // permission-gated empty-label scenario where the default entry is
    // the only one Chromium will surface). Last resort: defaultEntry's
    // literal `deviceId` (typically the opaque "default" string).
    const stableDeviceId =
      (match?.deviceId && match.deviceId !== 'default' ? match.deviceId : '') ||
      resolvedGroupId ||
      defaultEntry.deviceId ||
      '';
    return {
      deviceId: stableDeviceId,
      groupId: resolvedGroupId || '',
      label,
    };
  } catch {
    return EMPTY_DEVICE;
  }
}

/**
 * Unlock device labels by requesting microphone permission once. Modern
 * browsers (Chromium included) only populate `MediaDeviceInfo.label` when
 * the page has at least one active or previously-granted media permission.
 * Without this, `enumerateDevices` returns labels as empty strings.
 *
 * Idempotent — safe to call multiple times. Returns true when permission
 * was granted (or already had been) and labels are now available; false
 * when the user denied or the API is unavailable.
 */
export async function unlockSystemAudioDeviceLabels(): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately stop the tracks — we only requested permission to unlock
    // labels, we never want to actually record audio.
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * React hook returning the current system audio output device plus the
 * label and a stable id. Re-runs on mount + on every `devicechange` event
 * + optionally on a poll interval.
 */
export function useSystemAudioDevice(
  options: UseSystemAudioDeviceOptions = {}
): SystemAudioDeviceState {
  const { pollIntervalMs = 0, onChange } = options;
  const [device, setDevice] = useState<SystemAudioDevice>(EMPTY_DEVICE);
  // Track the last emitted device so the change-detection compares against
  // the most-recent value, not the stale closure-captured state.
  const lastDeviceRef = useRef<SystemAudioDevice>(EMPTY_DEVICE);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // v3.211 — refresh-handle ref. The internal `refresh` closure is recreated
  // on every effect-run; consumers reach it via the returned `refresh()`
  // callback, which trampolines through this ref so it always invokes the
  // CURRENT bound closure (correct `cancelled` flag, fresh state ref).
  const refreshRef = useRef<((isInitial: boolean) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (isInitial: boolean): Promise<void> => {
      const next = await readSystemAudioDevice();
      if (cancelled) return;
      const previous = lastDeviceRef.current;
      const changed =
        next.deviceId !== previous.deviceId ||
        next.groupId !== previous.groupId ||
        next.label !== previous.label;
      if (!changed) {
        return;
      }
      lastDeviceRef.current = next;
      setDevice(next);
      // Skip the initial-mount emission so consumers don't fire side
      // effects on "device was empty, now it's the current default" —
      // that's a startup state delivery, not a user-observable change.
      if (!isInitial && onChangeRef.current) {
        onChangeRef.current(next);
      }
    };

    refreshRef.current = (isInitial: boolean): void => {
      void refresh(isInitial);
    };

    void refresh(true);

    const handleDeviceChange = (): void => {
      void refresh(false);
    };

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.addEventListener === 'function'
    ) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (pollIntervalMs > 0) {
      pollTimer = setInterval(handleDeviceChange, pollIntervalMs);
    }

    return () => {
      cancelled = true;
      refreshRef.current = null;
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.removeEventListener === 'function'
      ) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
    };
  }, [pollIntervalMs]);

  /**
   * v3.211 — public refresh handle. Invokes the current bound refresh
   * closure with `isInitial=false`, so callers (e.g. post-permission unlock,
   * checklist-open re-sync) get the `onChange` side-effect path. Stable
   * across renders (the underlying ref is updated in-place inside the
   * effect). No-op if the hook isn't mounted (ref is null between unmount
   * and re-mount).
   */
  const refresh = useCallback((): void => {
    refreshRef.current?.(false);
  }, []);

  // v3.211 — memoize the returned state so consumers using it as a
  // useEffect dependency only re-fire when the underlying device actually
  // changes. The `device` state itself is referentially stable (React only
  // updates it on real changes), and `refresh` is a stable useCallback, so
  // this memo's deps are accurate.
  return useMemo<SystemAudioDeviceState>(
    () => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label,
      refresh,
    }),
    [device, refresh]
  );
}
