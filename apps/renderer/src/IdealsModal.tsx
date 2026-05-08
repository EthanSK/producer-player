import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  IDEAL_CURVE_MAX_FREQ,
  IDEAL_CURVE_MIN_FREQ,
  IDEAL_STEM_GUIDES,
  IDEAL_STEM_IDS,
  buildAllIdealStemCurves,
  type IdealCurvePoint,
  type IdealStemGuide,
  type IdealStemId,
} from './idealCurves';

interface IdealsModalProps {
  open: boolean;
  onClose: () => void;
}

type IdealsLayerId = 'ideal' | 'reference' | 'mix';

const GRAPH_WIDTH = 560;
const GRAPH_HEIGHT = 180;
const PADDING_LEFT = 46;
const PADDING_RIGHT = 14;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 30;
const DB_MIN = -18;
const DB_MAX = 6;
const FREQ_GRID_LINES = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
const DB_GRID_LINES = [-18, -12, -6, 0, 6];

function formatFreq(freq: number): string {
  if (freq >= 1000) {
    const k = freq / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${freq}`;
}

function freqToX(freq: number): number {
  const plotWidth = GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const logMin = Math.log10(IDEAL_CURVE_MIN_FREQ);
  const logMax = Math.log10(IDEAL_CURVE_MAX_FREQ);
  const logFreq = Math.log10(
    Math.max(IDEAL_CURVE_MIN_FREQ, Math.min(IDEAL_CURVE_MAX_FREQ, freq)),
  );
  return PADDING_LEFT + ((logFreq - logMin) / (logMax - logMin)) * plotWidth;
}

function dbToY(gainDb: number): number {
  const plotHeight = GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, gainDb));
  return PADDING_TOP + ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * plotHeight;
}

function buildCurvePath(curve: readonly IdealCurvePoint[]): string {
  return curve
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${freqToX(point.freq).toFixed(2)},${dbToY(point.gainDb).toFixed(2)}`;
    })
    .join(' ');
}

function buildFilledCurvePath(curve: readonly IdealCurvePoint[]): string {
  if (curve.length === 0) return '';
  const curvePath = buildCurvePath(curve);
  const zeroY = dbToY(0);
  const firstX = freqToX(curve[0].freq).toFixed(2);
  const lastX = freqToX(curve[curve.length - 1].freq).toFixed(2);
  return `${curvePath} L${lastX},${zeroY.toFixed(2)} L${firstX},${zeroY.toFixed(2)} Z`;
}

function buildStemExpandedDefaults(): Record<IdealStemId, boolean> {
  return {
    vocals: true,
    drums: true,
    bass: false,
    other: false,
  };
}

function IdealsCurveGraph({
  curve,
  guide,
  showIdeal,
}: {
  curve: readonly IdealCurvePoint[];
  guide: IdealStemGuide;
  showIdeal: boolean;
}): JSX.Element {
  const strokeGradientId = `ideals-curve-stroke-${guide.id}`;
  const fillGradientId = `ideals-curve-fill-${guide.id}`;
  const path = buildCurvePath(curve);
  const fillPath = buildFilledCurvePath(curve);

  return (
    <svg
      className="ideals-curve-graph"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      role="img"
      aria-label={`${guide.label} ideal EQ curve`}
      data-testid={`ideals-curve-${guide.id}`}
    >
      <defs>
        <linearGradient id={strokeGradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5ca7ff" />
          <stop offset="50%" stopColor={guide.accentColor} />
          <stop offset="100%" stopColor="#b46eff" />
        </linearGradient>
        <linearGradient id={fillGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={guide.accentColor} stopOpacity="0.22" />
          <stop offset="60%" stopColor="#5ca7ff" stopOpacity="0.08" />
          <stop offset="100%" stopColor={guide.accentColor} stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <rect
        x={PADDING_LEFT}
        y={PADDING_TOP}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM}
        rx="8"
        className="ideals-curve-plot-bg"
      />

      {FREQ_GRID_LINES.map((freq) => {
        const x = freqToX(freq);
        return (
          <g key={freq} className="ideals-curve-grid ideals-curve-grid--freq">
            <line x1={x} x2={x} y1={PADDING_TOP} y2={GRAPH_HEIGHT - PADDING_BOTTOM} />
            <text x={x} y={GRAPH_HEIGHT - 10}>{formatFreq(freq)}</text>
          </g>
        );
      })}

      {DB_GRID_LINES.map((db) => {
        const y = dbToY(db);
        return (
          <g
            key={db}
            className={`ideals-curve-grid ideals-curve-grid--db${db === 0 ? ' ideals-curve-grid--zero' : ''}`}
          >
            <line x1={PADDING_LEFT} x2={GRAPH_WIDTH - PADDING_RIGHT} y1={y} y2={y} />
            <text x={PADDING_LEFT - 8} y={y + 4}>{`${db > 0 ? '+' : ''}${db}`}</text>
          </g>
        );
      })}

      {showIdeal ? (
        <>
          <path className="ideals-curve-fill" d={fillPath} fill={`url(#${fillGradientId})`} />
          <path
            className="ideals-curve-stroke"
            d={path}
            stroke={`url(#${strokeGradientId})`}
          />
        </>
      ) : null}

      <path
        className="ideals-curve-future ideals-curve-future--reference"
        d="M46,94 C126,72 186,115 254,83 S390,88 546,64"
      />
      <path
        className="ideals-curve-future ideals-curve-future--mix"
        d="M46,116 C136,100 206,126 286,104 S430,116 546,90"
      />

      <rect
        x={PADDING_LEFT + 0.5}
        y={PADDING_TOP + 0.5}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT - 1}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM - 1}
        rx="8"
        className="ideals-curve-frame"
      />
    </svg>
  );
}

export function IdealsModal({ open, onClose }: IdealsModalProps): JSX.Element | null {
  const curvesByStem = useMemo(() => buildAllIdealStemCurves(), []);
  const [expandedByStem, setExpandedByStem] = useState<Record<IdealStemId, boolean>>(
    buildStemExpandedDefaults,
  );
  const [layers, setLayers] = useState<Record<IdealsLayerId, boolean>>({
    ideal: true,
    reference: false,
    mix: false,
  });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ideals-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ideals-modal-title"
      aria-describedby="ideals-modal-subtitle"
      data-testid="ideals-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="ideals-card">
        <div className="ideals-header">
          <div>
            <p className="ideals-eyebrow">Mastering spectrum guide</p>
            <h2 id="ideals-modal-title" data-testid="ideals-modal-title">
              Ideal stem EQ curves
            </h2>
            <p id="ideals-modal-subtitle" className="muted">
              Educational starting points for reading stem balance in the Spectrum Analyzer.
              Phase 1 is UI-only: reference/mix stem extraction is intentionally shown as a
              disabled future flow until the separation runtime is approved.
            </p>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            data-testid="ideals-modal-close"
            title="Close"
            aria-label="Close ideal EQ guide"
          >
            Close
          </button>
        </div>

        <div className="ideals-toolbar" aria-label="Curve layers and stem separation actions">
          <div className="ideals-layer-toggles" role="group" aria-label="Curve layers">
            <button
              type="button"
              className={`ideals-layer-toggle${layers.ideal ? ' active' : ''}`}
              aria-pressed={layers.ideal}
              onClick={() => setLayers((current) => ({ ...current, ideal: !current.ideal }))}
              data-testid="ideals-toggle-ideal"
              title="Show or hide the educational ideal curve."
            >
              Ideal
            </button>
            <button
              type="button"
              className="ideals-layer-toggle ideals-layer-toggle--future"
              aria-pressed={layers.reference}
              disabled
              data-testid="ideals-toggle-reference"
              title="Future phase: separate the currently playing reference track first."
            >
              Reference · future
            </button>
            <button
              type="button"
              className="ideals-layer-toggle ideals-layer-toggle--future"
              aria-pressed={layers.mix}
              disabled
              data-testid="ideals-toggle-mix"
              title="Future phase: separate your mix first."
            >
              Mix · future
            </button>
          </div>

          <div className="ideals-separation-actions" role="group" aria-label="Future stem separation actions">
            <button type="button" disabled data-testid="ideals-separate-mix">
              Separate mix
            </button>
            <button type="button" disabled data-testid="ideals-separate-reference">
              Separate reference
            </button>
            <button type="button" disabled data-testid="ideals-separate-all">
              Separate all
            </button>
          </div>
        </div>

        <div className="ideals-body">
          <section className="ideals-intro" data-testid="ideals-intro">
            <h3>How to use this</h3>
            <p>
              Start with the ideal curve to learn what each stem usually contributes. Later,
              the orange reference layer and blue mix layer will come from stem-separated audio
              so you can compare your current track against the currently playing reference.
            </p>
          </section>

          <div className="ideals-stem-grid" data-testid="ideals-stem-grid">
            {IDEAL_STEM_IDS.map((stemId) => {
              const guide = IDEAL_STEM_GUIDES[stemId];
              const expanded = expandedByStem[stemId];
              return (
                <section
                  key={stemId}
                  className={`ideals-stem-card${expanded ? ' ideals-stem-card--expanded' : ' ideals-stem-card--mini'}`}
                  data-testid={`ideals-stem-card-${stemId}`}
                  style={{ '--stem-accent': guide.accentColor } as CSSProperties}
                >
                  <div className="ideals-stem-card-header">
                    <div className="ideals-stem-title-block">
                      <span className="ideals-stem-chip">{guide.shortLabel}</span>
                      <div>
                        <h3>{guide.label}</h3>
                        <p>{guide.role}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ideals-expand-toggle"
                      onClick={() =>
                        setExpandedByStem((current) => ({
                          ...current,
                          [stemId]: !current[stemId],
                        }))
                      }
                      aria-expanded={expanded}
                      data-testid={`ideals-expand-${stemId}`}
                      title={expanded ? `Collapse ${guide.label} to mini view` : `Expand ${guide.label} to full view`}
                    >
                      {expanded ? 'Mini view' : 'Full view'}
                    </button>
                  </div>

                  <p className="ideals-stem-summary">{guide.summary}</p>

                  <IdealsCurveGraph
                    curve={curvesByStem[stemId]}
                    guide={guide}
                    showIdeal={layers.ideal}
                  />

                  {expanded ? (
                    <div className="ideals-stem-details">
                      <p>{guide.explanation}</p>
                      <ul>
                        {guide.listeningNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                      <p className="ideals-source-placeholder">
                        <strong>Source placeholder:</strong> {guide.sourcePlaceholder}
                      </p>
                      <div className="ideals-stem-future-actions" aria-label={`${guide.label} future stem actions`}>
                        <button type="button" disabled>
                          Listen to {guide.shortLabel}
                        </button>
                        <button type="button" disabled>
                          Draw reference overlay
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
