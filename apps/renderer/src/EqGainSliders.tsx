import { useCallback, useRef, type CSSProperties } from 'react';
import { FREQUENCY_BANDS, frequencyToX } from './audioEngine';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;

/** dB range for the per-band EQ sliders. */
export const EQ_GAIN_MIN_DB = -12;
export const EQ_GAIN_MAX_DB = 12;
export const EQ_GAIN_DEFAULT_DB = 0;

export interface EqGainSlidersProps {
  /** Current gain values per band (array of dB, one per FREQUENCY_BANDS entry). */
  gains: readonly number[];
  /** Called when the user drags a slider. */
  onGainChange: (bandIndex: number, gainDb: number) => void;
  /** Called when the user double-clicks a slider to reset it. */
  onGainReset: (bandIndex: number) => void;
  /** Called to reset all bands. */
  onResetAll: () => void;
  /** Width of the parent spectrum analyzer (used to position sliders). */
  spectrumWidth: number;
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
  spectrumWidth,
}: EqGainSlidersProps): JSX.Element {
  const hasAnyGain = gains.some((g) => g !== EQ_GAIN_DEFAULT_DB);

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
