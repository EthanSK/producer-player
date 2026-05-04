import { useEffect, useMemo, useRef } from 'react';
import { buildKWeightingCurve } from './kWeighting';

interface KWeightingCurveModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user clicks the close button or the backdrop. */
  onClose: () => void;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_MIN = -24;
const DB_MAX = 8;

const FREQ_GRID_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const DB_GRID_LINES = [-20, -15, -10, -5, 0, 5];

const PADDING_LEFT = 56;
const PADDING_RIGHT = 18;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 36;

function formatFreq(freq: number): string {
  if (freq >= 1000) {
    const k = freq / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${freq}`;
}

function freqToX(freq: number, plotLeft: number, plotWidth: number): number {
  const logMin = Math.log10(MIN_FREQ);
  const logMax = Math.log10(MAX_FREQ);
  const logF = Math.log10(Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq)));
  return plotLeft + ((logF - logMin) / (logMax - logMin)) * plotWidth;
}

function dbToY(db: number, plotTop: number, plotHeight: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return plotTop + ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * plotHeight;
}

/**
 * v3.110 — K-weighting curve modal.
 *
 * Plots the ITU-R BS.1770-4 K-weighting magnitude response on a log-frequency
 * vs dB grid, with a short explanation of what the curve actually is and
 * how it relates to LUFS measurement.
 *
 * Important: this is the per-frequency WEIGHT applied during LUFS
 * integration, NOT a per-frequency loudness reading of the user's track.
 * The wording in the modal makes that distinction explicit.
 */
export function KWeightingCurveModal({
  open,
  onClose,
}: KWeightingCurveModalProps): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const curve = useMemo(() => buildKWeightingCurve(256), []);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const plotLeft = PADDING_LEFT;
    const plotRight = cssWidth - PADDING_RIGHT;
    const plotTop = PADDING_TOP;
    const plotBottom = cssHeight - PADDING_BOTTOM;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    // Background
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Plot area background (slightly lighter so the gridlines pop)
    ctx.fillStyle = 'rgba(92, 167, 255, 0.03)';
    ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';

    // Vertical (frequency) grid lines + labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6b8199';
    ctx.textAlign = 'center';
    for (const f of FREQ_GRID_LINES) {
      const x = freqToX(f, plotLeft, plotWidth);
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillText(formatFreq(f), x, plotBottom + 14);
    }

    // Horizontal (dB) grid lines + labels — emphasise 0 dB
    ctx.textAlign = 'right';
    for (const db of DB_GRID_LINES) {
      const y = dbToY(db, plotTop, plotHeight);
      ctx.strokeStyle = db === 0
        ? 'rgba(255, 255, 255, 0.18)'
        : 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillStyle = db === 0 ? '#9ab2cf' : '#6b8199';
      ctx.fillText(`${db > 0 ? '+' : ''}${db}`, plotLeft - 8, y + 3);
    }

    // K-weighting curve — gradient stroke for visual punch
    if (curve.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < curve.length; i++) {
        const p = curve[i];
        const x = freqToX(p.freq, plotLeft, plotWidth);
        const y = dbToY(p.gainDb, plotTop, plotHeight);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Fill below curve (faint, anchored to 0 dB so positive-region fill
      // appears above the line and negative-region fill appears below it)
      const zeroY = dbToY(0, plotTop, plotHeight);
      ctx.save();
      ctx.lineTo(plotRight, zeroY);
      ctx.lineTo(plotLeft, zeroY);
      ctx.closePath();
      const fillGradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      fillGradient.addColorStop(0, 'rgba(180, 110, 255, 0.18)');
      fillGradient.addColorStop(0.5, 'rgba(92, 167, 255, 0.08)');
      fillGradient.addColorStop(1, 'rgba(92, 167, 255, 0.18)');
      ctx.fillStyle = fillGradient;
      ctx.fill();
      ctx.restore();

      // Stroke the curve again on top of the fill for crispness
      ctx.beginPath();
      for (let i = 0; i < curve.length; i++) {
        const p = curve[i];
        const x = freqToX(p.freq, plotLeft, plotWidth);
        const y = dbToY(p.gainDb, plotTop, plotHeight);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const strokeGradient = ctx.createLinearGradient(plotLeft, 0, plotRight, 0);
      strokeGradient.addColorStop(0, '#5ca7ff');
      strokeGradient.addColorStop(1, '#b46eff');
      ctx.strokeStyle = strokeGradient;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotWidth, plotHeight);

    // Axis labels
    ctx.fillStyle = '#9ab2cf';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', (plotLeft + plotRight) / 2, cssHeight - 8);

    ctx.save();
    ctx.translate(14, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Weight (dB)', 0, 0);
    ctx.restore();
  }, [curve, open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="k-weighting-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="LUFS frequency weighting curve"
      data-testid="k-weighting-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="k-weighting-card">
        <div className="k-weighting-header">
          <div>
            <h2 data-testid="k-weighting-modal-title">Frequency weighting (LUFS K-curve)</h2>
            <p className="muted">
              Per-frequency weight applied to your track during LUFS / EBU R128 loudness
              measurement. This is not a reading of your track — it is the fixed
              perceptual filter the standard applies before integrating loudness.
            </p>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            data-testid="k-weighting-modal-close"
            title="Close"
            aria-label="Close frequency weighting graph"
          >
            Close
          </button>
        </div>

        <div className="k-weighting-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="k-weighting-canvas"
            data-testid="k-weighting-canvas"
          />
        </div>

        <div className="k-weighting-explanation" data-testid="k-weighting-explanation">
          <h3>What you're looking at</h3>
          <p>
            This is the <strong>K-weighting curve</strong> from ITU-R BS.1770-4 — the
            per-frequency weight that LUFS applies before it adds up loudness across the
            spectrum. A frequency above the line counts for <em>more</em> than its raw
            energy in the LUFS number; a frequency below the line counts for <em>less</em>.
          </p>
          <ul>
            <li>
              Sub-bass (20 Hz) is attenuated by roughly 14 dB — very low frequencies barely
              count toward LUFS, even when they hit hard on a subwoofer.
            </li>
            <li>
              Mid frequencies (around 1 kHz) are the reference point, weighted at 0 dB.
            </li>
            <li>
              High frequencies (above ~2 kHz) are boosted by up to about +4 dB — the ear
              is more sensitive there, so LUFS counts them as louder.
            </li>
          </ul>
          <p>
            Practically: if you push energy into the 2–10 kHz region, your LUFS reading
            will climb faster than if you pile the same energy into the sub-bass. Knowing
            the shape of this curve helps explain why two masters with similar peak levels
            can read very differently in LUFS.
          </p>
          <p className="k-weighting-note">
            Reference: ITU-R BS.1770-4, Annex 1. The curve is plotted at the standard's
            48 kHz reference sample rate and normalised so that 1 kHz reads as 0 dB —
            this is the conventional way the K-weighting shape is displayed.
          </p>
        </div>
      </div>
    </div>
  );
}
