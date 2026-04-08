import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { EqSnapshot } from '@producer-player/contracts';
import { FREQUENCY_BANDS, frequencyToX } from './audioEngine';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;

/** dB range for the per-band EQ sliders. */
export const EQ_GAIN_MIN_DB = -12;
export const EQ_GAIN_MAX_DB = 12;
export const EQ_GAIN_DEFAULT_DB = 0;

/** Maximum number of saved EQ snapshots. */
const MAX_EQ_SNAPSHOTS = 10;
const EQ_SNAPSHOTS_STORAGE_KEY_PREFIX = 'producer-player-eq-snapshots';
/** Old global key used before per-song storage was introduced. */
const EQ_SNAPSHOTS_OLD_GLOBAL_KEY = 'producer-player-eq-snapshots';
const EQ_SNAPSHOTS_GLOBAL_MIGRATED_KEY = 'producer-player-eq-snapshots-global-migrated';

export type { EqSnapshot } from '@producer-player/contracts';

function storageKeyForSong(songKey: string): string {
  return `${EQ_SNAPSHOTS_STORAGE_KEY_PREFIX}-${songKey}`;
}

function parseSnapshotArray(raw: string | null): EqSnapshot[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: unknown): s is EqSnapshot =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as EqSnapshot).id === 'string' &&
        Array.isArray((s as EqSnapshot).gains) &&
        typeof (s as EqSnapshot).timestamp === 'number'
    );
  } catch {
    return [];
  }
}

function loadSnapshots(songKey: string | undefined): EqSnapshot[] {
  if (!songKey) return [];
  try {
    const perSong = parseSnapshotArray(localStorage.getItem(storageKeyForSong(songKey)));
    if (perSong.length > 0) return perSong;

    // Migrate from old global key (pre per-song storage) if available and not yet migrated.
    const alreadyMigrated = localStorage.getItem(EQ_SNAPSHOTS_GLOBAL_MIGRATED_KEY);
    if (!alreadyMigrated) {
      const globalSnapshots = parseSnapshotArray(localStorage.getItem(EQ_SNAPSHOTS_OLD_GLOBAL_KEY));
      if (globalSnapshots.length > 0) {
        // Copy old global snapshots to this song's per-song key
        localStorage.setItem(storageKeyForSong(songKey), JSON.stringify(globalSnapshots));
        localStorage.setItem(EQ_SNAPSHOTS_GLOBAL_MIGRATED_KEY, 'true');
        return globalSnapshots;
      }
      // Mark as migrated even if empty so we only check once
      localStorage.setItem(EQ_SNAPSHOTS_GLOBAL_MIGRATED_KEY, 'true');
    }

    return [];
  } catch {
    return [];
  }
}

function saveSnapshots(songKey: string | undefined, snapshots: EqSnapshot[]): void {
  if (!songKey) return;
  try {
    localStorage.setItem(storageKeyForSong(songKey), JSON.stringify(snapshots));
  } catch {
    /* localStorage may be full or unavailable */
  }
}

/** Format a gain value as a compact string like "+2" or "-1" or "0". */
function formatGainCompact(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  if (rounded === 0) return '0';
  const str = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  return rounded > 0 ? `+${str}` : str;
}

export interface EqGainSlidersProps {
  /** Current gain values per band (array of dB, one per FREQUENCY_BANDS entry). */
  gains: readonly number[];
  /** Called when the user drags a slider. */
  onGainChange: (bandIndex: number, gainDb: number) => void;
  /** Called when the user double-clicks a slider to reset it. */
  onGainReset: (bandIndex: number) => void;
  /** Called to reset all bands. */
  onResetAll: () => void;
  /** Called to restore a full set of gain values (e.g. from a snapshot). */
  onRestoreGains: (gains: number[]) => void;
  /** Width of the parent spectrum analyzer (used to position sliders). */
  spectrumWidth: number;
  /** Whether the EQ is currently active (gains applied). Default true. */
  eqEnabled?: boolean;
  /** Called when the user toggles the EQ bypass. */
  onToggleEq?: () => void;
  /** Unique key for the current song — snapshots are stored per-song. */
  songKey?: string;
  /** Optional content rendered at the right end of the EQ controls row. */
  rightContent?: ReactNode;
}

/**
 * Per-band EQ gain sliders overlaid above the spectrum analyzer canvas.
 * Each horizontal slider sits at the center of its corresponding frequency region.
 */
export function EqGainSliders({
  gains,
  onGainChange,
  onGainReset,
  onResetAll,
  onRestoreGains,
  spectrumWidth,
  eqEnabled = true,
  onToggleEq,
  songKey,
  rightContent,
}: EqGainSlidersProps): JSX.Element {
  const hasAnyGain = gains.some((g) => g !== EQ_GAIN_DEFAULT_DB);
  const [snapshots, setSnapshots] = useState<EqSnapshot[]>(() => loadSnapshots(songKey));

  // Reload snapshots from localStorage when the song changes
  useEffect(() => {
    setSnapshots(loadSnapshots(songKey));
  }, [songKey]);

  // Persist snapshots to localStorage whenever they change
  useEffect(() => {
    saveSnapshots(songKey, snapshots);
  }, [songKey, snapshots]);

  function handleSaveSnapshot(): void {
    const snap: EqSnapshot = {
      id: crypto.randomUUID(),
      gains: [...gains],
      timestamp: Date.now(),
    };
    setSnapshots((prev) => {
      const next = [...prev, snap];
      // Circular buffer: drop oldest when exceeding max
      const trimmed = next.length > MAX_EQ_SNAPSHOTS
        ? next.slice(next.length - MAX_EQ_SNAPSHOTS)
        : next;
      // Persist immediately so the save isn't deferred to useEffect
      saveSnapshots(songKey, trimmed);
      return trimmed;
    });
  }

  function handleRestoreSnapshot(snap: EqSnapshot): void {
    onRestoreGains(snap.gains);
  }

  function handleDeleteSnapshot(id: string): void {
    setSnapshots((prev) => {
      const next = prev.filter((s) => s.id !== id);
      // Persist immediately so the deletion isn't deferred to useEffect
      saveSnapshots(songKey, next);
      return next;
    });
  }

  return (
    <div className="eq-gain-sliders" data-testid="eq-gain-sliders">
      <div className="eq-gain-sliders-row" style={{ width: spectrumWidth }}>
        {FREQUENCY_BANDS.map((band, i) => {
          const x1 = frequencyToX(band.minHz, spectrumWidth, MIN_FREQ, MAX_FREQ);
          const x2 = frequencyToX(band.maxHz, spectrumWidth, MIN_FREQ, MAX_FREQ);
          const cx = (x1 + x2) / 2;
          const regionWidth = x2 - x1;

          return (
            <EqBandSlider
              key={band.label}
              bandIndex={i}
              label={band.shortLabel}
              color={band.color}
              gainDb={gains[i]}
              centerX={cx}
              regionWidth={regionWidth}
              onGainChange={onGainChange}
              onGainReset={onGainReset}
            />
          );
        })}
      </div>
      <div className="eq-controls-row">
        <div className="eq-controls-left">
          {onToggleEq && (
            <button
              type="button"
              className={`ghost eq-toggle-button${eqEnabled ? '' : ' eq-toggle-button--off'}`}
              data-testid="eq-toggle"
              onClick={onToggleEq}
              title={eqEnabled ? 'Bypass EQ (keep slider positions).' : 'Re-enable EQ.'}
            >
              {eqEnabled ? 'EQ On' : 'EQ Off'}
            </button>
          )}
          {hasAnyGain && (
            <button
              type="button"
              className="ghost eq-reset-all-button"
              data-testid="eq-reset-all"
              onClick={onResetAll}
              title="Reset all EQ bands to 0 dB."
            >
              Reset EQ
            </button>
          )}
          <button
            type="button"
            className="ghost eq-save-snapshot-button"
            data-testid="eq-save-snapshot"
            onClick={handleSaveSnapshot}
            title="Save current EQ settings as a snapshot."
          >
            Save
          </button>
          {snapshots.length > 0 && (
            <div className="eq-snapshots-inline" data-testid="eq-snapshots-row">
              {[...snapshots].reverse().map((snap, idx) => (
                <div key={snap.id} className="eq-snapshot-pill" data-testid={`eq-snapshot-${idx}`}>
                  <button
                    type="button"
                    className="eq-snapshot-pill-button"
                    onClick={() => handleRestoreSnapshot(snap)}
                    title={snap.gains.map(formatGainCompact).join('  ')}
                  >
                    <span className="eq-snapshot-pill-label">
                      {snap.gains.map(formatGainCompact).join(' ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="eq-snapshot-delete"
                    data-testid={`eq-snapshot-delete-${idx}`}
                    onClick={() => handleDeleteSnapshot(snap.id)}
                    title="Delete snapshot"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {rightContent && (
          <div className="eq-controls-right">
            {rightContent}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Individual band slider ----

interface EqBandSliderProps {
  bandIndex: number;
  label: string;
  color: string;
  gainDb: number;
  centerX: number;
  regionWidth: number;
  onGainChange: (bandIndex: number, gainDb: number) => void;
  onGainReset: (bandIndex: number) => void;
}

function EqBandSlider({
  bandIndex,
  label,
  color,
  gainDb,
  centerX,
  regionWidth,
  onGainChange,
  onGainReset,
}: EqBandSliderProps): JSX.Element {
  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const trackWidth = Math.max(40, regionWidth - 4);
  const thumbSize = 14;

  /** Convert a dB value to an X fraction (0 = left = -12, 1 = right = +12). */
  const dbToFraction = useCallback((db: number): number => {
    return (db - EQ_GAIN_MIN_DB) / (EQ_GAIN_MAX_DB - EQ_GAIN_MIN_DB);
  }, []);

  /** Convert an X fraction to dB, snapping to 0 when close. */
  const fractionToDb = useCallback((frac: number): number => {
    const raw = EQ_GAIN_MIN_DB + frac * (EQ_GAIN_MAX_DB - EQ_GAIN_MIN_DB);
    const clamped = Math.max(EQ_GAIN_MIN_DB, Math.min(EQ_GAIN_MAX_DB, raw));
    // Snap to 0 within 0.5 dB
    return Math.abs(clamped) < 0.5 ? 0 : Math.round(clamped * 10) / 10;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      draggingRef.current = true;

      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const frac = Math.max(0, Math.min(1, x / trackWidth));
      onGainChange(bandIndex, fractionToDb(frac));
    },
    [bandIndex, fractionToDb, onGainChange, trackWidth]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const frac = Math.max(0, Math.min(1, x / trackWidth));
      onGainChange(bandIndex, fractionToDb(frac));
    },
    [bandIndex, fractionToDb, onGainChange, trackWidth]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    []
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onGainReset(bandIndex);
    },
    [bandIndex, onGainReset]
  );

  const fraction = dbToFraction(gainDb);
  const thumbLeft = fraction * trackWidth - thumbSize / 2;
  const zeroFraction = dbToFraction(0);
  const zeroX = zeroFraction * trackWidth;
  const thumbCenter = fraction * trackWidth;

  // Fill bar from zero line to current position
  const fillLeft = Math.min(zeroX, thumbCenter);
  const fillWidth = Math.abs(thumbCenter - zeroX);

  const isNonZero = gainDb !== 0;
  const dbText = gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1);

  const sliderContainerStyle: CSSProperties = {
    position: 'absolute',
    left: centerX - trackWidth / 2,
    width: trackWidth,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  return (
    <div
      className="eq-band-slider"
      style={sliderContainerStyle}
      data-testid={`eq-band-slider-${bandIndex}`}
    >
      <div
        ref={sliderRef}
        className="eq-slider-track"
        style={{ width: trackWidth }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        title={`${label}: ${dbText} dB — drag to adjust, double-click to reset`}
      >
        {/* Zero line */}
        <div
          className="eq-slider-zero-line"
          style={{ left: zeroX }}
        />
        {/* Fill bar */}
        {isNonZero && (
          <div
            className="eq-slider-fill"
            style={{
              left: fillLeft,
              width: fillWidth,
              backgroundColor: color,
              opacity: 0.5,
            }}
          />
        )}
        {/* Thumb */}
        <div
          className="eq-slider-thumb"
          style={{
            left: thumbLeft,
            backgroundColor: isNonZero ? color : 'rgba(156, 175, 196, 0.6)',
            borderColor: isNonZero ? color : 'rgba(156, 175, 196, 0.4)',
          }}
        />
      </div>
      {/* Label */}
      <span
        className={`eq-slider-label ${isNonZero ? 'eq-slider-label-active' : ''}`}
        style={isNonZero ? { color } : undefined}
      >
        {isNonZero ? dbText : label}
      </span>
    </div>
  );
}
