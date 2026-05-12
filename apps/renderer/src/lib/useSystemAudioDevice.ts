import { useEffect, useRef, useState } from 'react';

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
   * Stable identifier for the system's current default audio output. We use
   * the `groupId` of the entry whose `deviceId === 'default'` because the
   * literal `deviceId` of that entry is the (origin-scoped, opaque) string
   * "default", which is the same across machines and not useful for
   * associating with a saved listening device. `groupId` resolves to the
   * underlying real device and is stable across sessions on the same
   * machine.
   *
   * Empty string when no audio outputs are visible (e.g. permission not
   * granted, no enumerate result).
   */
  deviceId: string;
  /**
   * Human-readable name of the device (e.g. "MacBook Pro Speakers", "AirPods
   * Pro"). Empty string when labels are unavailable (permission not granted)
   * — call `unlockSystemAudioDeviceLabels()` once to unlock these.
   */
  label: string;
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

const EMPTY_DEVICE: SystemAudioDevice = { deviceId: '', label: '' };

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
    // the real underlying device's group. Prefer that — it's how Chromium
    // signals "this is what audio is currently going to". Fall back to the
    // first output if `default` isn't present (rare; some Linux distros).
    const defaultEntry = outputs.find((d) => d.deviceId === 'default') ?? outputs[0];
    const resolvedGroupId = defaultEntry.groupId;
    // The `default` entry's own label is usually "Default - <name>". Prefer
    // the matching non-default entry's clean label when we can resolve it
    // via groupId. Otherwise fall back to the default entry's label.
    const match = outputs.find(
      (d) => d.deviceId !== 'default' && d.groupId === resolvedGroupId
    );
    const label = (match?.label ?? defaultEntry.label ?? '').trim();
    return {
      deviceId: resolvedGroupId || defaultEntry.deviceId || '',
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
): SystemAudioDevice {
  const { pollIntervalMs = 0, onChange } = options;
  const [device, setDevice] = useState<SystemAudioDevice>(EMPTY_DEVICE);
  // Track the last emitted device so the change-detection compares against
  // the most-recent value, not the stale closure-captured state.
  const lastDeviceRef = useRef<SystemAudioDevice>(EMPTY_DEVICE);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;

    const refresh = async (isInitial: boolean): Promise<void> => {
      const next = await readSystemAudioDevice();
      if (cancelled) return;
      const previous = lastDeviceRef.current;
      const changed = next.deviceId !== previous.deviceId || next.label !== previous.label;
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

  return device;
}
