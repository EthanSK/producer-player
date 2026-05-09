import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import {
  analyzeIdealStemSource,
  buildIdealStemCacheKey,
  clearIdealStemAnalysisCache,
  formatIdealStemMetricDb,
  getCachedIdealStemAnalysis,
  getIdealStemCacheState,
  type IdealStemAnalysisResult,
  type IdealStemAnalysisSource,
  type IdealStemSourceKind,
} from './idealStemAnalysis';

export type { IdealStemAnalysisSource } from './idealStemAnalysis';

interface IdealsModalProps {
  open: boolean;
  onClose: () => void;
  mixSource: IdealStemAnalysisSource | null;
  referenceSource: IdealStemAnalysisSource | null;
}

type IdealsLayerId = 'ideal' | 'reference' | 'mix';
type StemSourceStatus = 'idle' | 'running' | 'ready' | 'error' | 'cancelled';

interface StemSourceState {
  status: StemSourceStatus;
  cacheKey: string | null;
  result: IdealStemAnalysisResult | null;
  error: string | null;
}

const GRAPH_WIDTH = 560;
const GRAPH_HEIGHT = 180;
const PADDING_LEFT = 46;
const PADDING_RIGHT = 14;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 30;
const DB_MIN = -24;
const DB_MAX = 6;
const FREQ_GRID_LINES = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
const DB_GRID_LINES = [-24, -18, -12, -6, 0, 6];

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

function buildInitialSourceState(): Record<IdealStemSourceKind, StemSourceState> {
  return {
    mix: { status: 'idle', cacheKey: null, result: null, error: null },
    reference: { status: 'idle', cacheKey: null, result: null, error: null },
  };
}

function sourceStateFromCache(source: IdealStemAnalysisSource | null): StemSourceState {
  if (!source) {
    return { status: 'idle', cacheKey: null, result: null, error: null };
  }

  const cacheKey = buildIdealStemCacheKey(source);
  const cached = getCachedIdealStemAnalysis(cacheKey);
  if (cached) {
    return { status: 'ready', cacheKey, result: cached, error: null };
  }

  const cacheState = getIdealStemCacheState(cacheKey);
  return {
    status: cacheState === 'in-flight' ? 'running' : 'idle',
    cacheKey,
    result: null,
    error: null,
  };
}

function getSourceLabel(kind: IdealStemSourceKind): string {
  return kind === 'mix' ? 'Your Mix' : 'Reference';
}

function getSourceActionLabel(kind: IdealStemSourceKind): string {
  return kind === 'mix' ? 'Stem Separate Yours' : 'Stem Separate Reference';
}

function formatSourceStatus(
  kind: IdealStemSourceKind,
  source: IdealStemAnalysisSource | null,
  state: StemSourceState,
): string {
  if (!source) {
    return kind === 'mix' ? 'No current mix selected' : 'No reference loaded';
  }
  if (source.exists === false) {
    return `${getSourceLabel(kind)} file missing`;
  }
  switch (state.status) {
    case 'running':
      return 'Separating/analyzing…';
    case 'ready':
      return 'Proxy stems ready';
    case 'error':
      return state.error ?? 'Stem analysis failed';
    case 'cancelled':
      return 'Cancelled';
    case 'idle':
    default:
      return 'Not analyzed yet';
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function IdealsCurveGraph({
  idealCurve,
  mixCurve,
  referenceCurve,
  guide,
  showIdeal,
  showMix,
  showReference,
}: {
  idealCurve: readonly IdealCurvePoint[];
  mixCurve?: readonly IdealCurvePoint[];
  referenceCurve?: readonly IdealCurvePoint[];
  guide: IdealStemGuide;
  showIdeal: boolean;
  showMix: boolean;
  showReference: boolean;
}): JSX.Element {
  const strokeGradientId = `ideals-curve-stroke-${guide.id}`;
  const fillGradientId = `ideals-curve-fill-${guide.id}`;
  const idealPath = buildCurvePath(idealCurve);
  const fillPath = buildFilledCurvePath(idealCurve);
  const mixPath = mixCurve ? buildCurvePath(mixCurve) : '';
  const referencePath = referenceCurve ? buildCurvePath(referenceCurve) : '';

  return (
    <svg
      className="ideals-curve-graph"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      role="img"
      aria-label={`${guide.label} ideal, mix, and reference EQ curves`}
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
            className="ideals-curve-stroke ideals-curve-stroke--ideal"
            d={idealPath}
            stroke={`url(#${strokeGradientId})`}
          />
        </>
      ) : null}

      {showMix && mixPath ? (
        <path
          className="ideals-curve-stroke ideals-curve-stroke--mix"
          d={mixPath}
          data-testid={`ideals-mix-curve-${guide.id}`}
        />
      ) : null}

      {showReference && referencePath ? (
        <path
          className="ideals-curve-stroke ideals-curve-stroke--reference"
          d={referencePath}
          data-testid={`ideals-reference-curve-${guide.id}`}
        />
      ) : null}

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

function StemSlot({
  kind,
  stemId,
  state,
  source,
}: {
  kind: IdealStemSourceKind;
  stemId: IdealStemId;
  state: StemSourceState;
  source: IdealStemAnalysisSource | null;
}): JSX.Element {
  const resultStem = state.result?.stems[stemId] ?? null;
  const statusText = formatSourceStatus(kind, source, state);
  const label = getSourceLabel(kind);
  const audioLabel = `${label} ${IDEAL_STEM_GUIDES[stemId].shortLabel} proxy stem`;

  return (
    <div className={`ideals-stem-slot ideals-stem-slot--${kind}`} data-testid={`ideals-${kind}-slot-${stemId}`}>
      <div className="ideals-stem-slot-header">
        <span className="ideals-stem-slot-label">{label}</span>
        <span className={`ideals-stem-slot-status ideals-stem-slot-status--${state.status}`}>
          {statusText}
        </span>
      </div>
      {resultStem ? (
        <>
          <audio
            className="ideals-stem-audio"
            controls
            preload="none"
            src={resultStem.audioUrl}
            aria-label={audioLabel}
            data-testid={`ideals-${kind}-audio-${stemId}`}
          />
          <div className="ideals-stem-metrics">
            <span>Peak {formatIdealStemMetricDb(resultStem.metrics.peakDbfs)}</span>
            <span>RMS {formatIdealStemMetricDb(resultStem.metrics.rmsDbfs)}</span>
          </div>
        </>
      ) : (
        <p className="ideals-stem-slot-empty">
          {kind === 'mix'
            ? 'Run yours to draw the blue overlay and audition this proxy stem.'
            : 'Run reference to draw the amber overlay and audition this proxy stem.'}
        </p>
      )}
    </div>
  );
}

export function IdealsModal({
  open,
  onClose,
  mixSource,
  referenceSource,
}: IdealsModalProps): JSX.Element | null {
  const curvesByStem = useMemo(() => buildAllIdealStemCurves(), []);
  const [expandedByStem, setExpandedByStem] = useState<Record<IdealStemId, boolean>>(
    buildStemExpandedDefaults,
  );
  const [layers, setLayers] = useState<Record<IdealsLayerId, boolean>>({
    ideal: true,
    reference: false,
    mix: false,
  });
  const [sourceStates, setSourceStates] = useState<Record<IdealStemSourceKind, StemSourceState>>(
    buildInitialSourceState,
  );
  const controllersRef = useRef<Record<IdealStemSourceKind, AbortController | null>>({
    mix: null,
    reference: null,
  });

  const sources = useMemo(
    () => ({ mix: mixSource, reference: referenceSource }),
    [mixSource, referenceSource],
  );
  const mixCacheKey = mixSource ? buildIdealStemCacheKey(mixSource) : null;
  const referenceCacheKey = referenceSource ? buildIdealStemCacheKey(referenceSource) : null;

  useEffect(() => {
    setSourceStates((current) => {
      const nextMix =
        current.mix.cacheKey === mixCacheKey && current.mix.status === 'running'
          ? current.mix
          : sourceStateFromCache(mixSource);
      const nextReference =
        current.reference.cacheKey === referenceCacheKey && current.reference.status === 'running'
          ? current.reference
          : sourceStateFromCache(referenceSource);
      return { mix: nextMix, reference: nextReference };
    });
  }, [mixCacheKey, mixSource, referenceCacheKey, referenceSource]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      controllersRef.current.mix?.abort();
      controllersRef.current.reference?.abort();
    };
  }, []);

  const startAnalysis = useCallback(
    async (kind: IdealStemSourceKind, force = false): Promise<void> => {
      const source = sources[kind];
      if (!source) {
        setSourceStates((current) => ({
          ...current,
          [kind]: {
            status: 'error',
            cacheKey: null,
            result: null,
            error: kind === 'mix' ? 'Select a mix first.' : 'Load a reference first.',
          },
        }));
        return;
      }

      const cacheKey = buildIdealStemCacheKey(source);
      controllersRef.current[kind]?.abort();
      const controller = new AbortController();
      controllersRef.current[kind] = controller;

      setSourceStates((current) => ({
        ...current,
        [kind]: { status: 'running', cacheKey, result: force ? null : current[kind].result, error: null },
      }));

      try {
        const result = await analyzeIdealStemSource(source, {
          signal: controller.signal,
          force,
        });
        setSourceStates((current) => ({
          ...current,
          [kind]: { status: 'ready', cacheKey: result.cacheKey, result, error: null },
        }));
        setLayers((current) => ({ ...current, [kind]: true }));
      } catch (cause: unknown) {
        setSourceStates((current) => ({
          ...current,
          [kind]: {
            status: isAbortError(cause) ? 'cancelled' : 'error',
            cacheKey,
            result: null,
            error: isAbortError(cause)
              ? 'Stem analysis was cancelled.'
              : cause instanceof Error
                ? cause.message
                : String(cause),
          },
        }));
      } finally {
        if (controllersRef.current[kind] === controller) {
          controllersRef.current[kind] = null;
        }
      }
    },
    [sources],
  );

  const cancelAnalysis = useCallback((kind: IdealStemSourceKind): void => {
    controllersRef.current[kind]?.abort();
    controllersRef.current[kind] = null;
  }, []);

  const clearSource = useCallback(
    (kind: IdealStemSourceKind): void => {
      controllersRef.current[kind]?.abort();
      controllersRef.current[kind] = null;
      const source = sources[kind];
      if (source) {
        clearIdealStemAnalysisCache(source);
      }
      setSourceStates((current) => ({
        ...current,
        [kind]: { status: 'idle', cacheKey: source ? buildIdealStemCacheKey(source) : null, result: null, error: null },
      }));
      setLayers((current) => ({ ...current, [kind]: false }));
    },
    [sources],
  );

  const startAll = useCallback((): void => {
    if (mixSource) void startAnalysis('mix');
    if (referenceSource) void startAnalysis('reference');
  }, [mixSource, referenceSource, startAnalysis]);

  const mixReady = sourceStates.mix.status === 'ready' && sourceStates.mix.result !== null;
  const referenceReady =
    sourceStates.reference.status === 'ready' && sourceStates.reference.result !== null;
  const anyRunning = sourceStates.mix.status === 'running' || sourceStates.reference.status === 'running';

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
              Educational ideal curves plus live stem-like analysis for your mix and reference.
              The local fallback is usable end-to-end now: it creates Web Audio proxy stems for
              graphs and audition, with honest labels until an approved ML separator is added.
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
              className={`ideals-layer-toggle ideals-layer-toggle--mix${layers.mix && mixReady ? ' active' : ''}`}
              aria-pressed={layers.mix && mixReady}
              disabled={!mixReady}
              onClick={() => setLayers((current) => ({ ...current, mix: !current.mix }))}
              data-testid="ideals-toggle-mix"
              title={mixReady ? 'Show or hide your mix proxy-stem curves.' : 'Analyze your mix first.'}
            >
              Your Mix
            </button>
            <button
              type="button"
              className={`ideals-layer-toggle ideals-layer-toggle--reference${layers.reference && referenceReady ? ' active' : ''}`}
              aria-pressed={layers.reference && referenceReady}
              disabled={!referenceReady}
              onClick={() => setLayers((current) => ({ ...current, reference: !current.reference }))}
              data-testid="ideals-toggle-reference"
              title={referenceReady ? 'Show or hide reference proxy-stem curves.' : 'Analyze a loaded reference first.'}
            >
              Reference
            </button>
          </div>

          <div className="ideals-separation-actions" role="group" aria-label="Stem separation and analysis actions">
            {(['mix', 'reference'] as const).map((kind) => {
              const source = sources[kind];
              const state = sourceStates[kind];
              const running = state.status === 'running';
              return (
                <span key={kind} className="ideals-source-action-cluster">
                  <button
                    type="button"
                    disabled={!source || running || source.exists === false}
                    onClick={() => void startAnalysis(kind, false)}
                    data-testid={`ideals-separate-${kind}`}
                    title={source ? getSourceActionLabel(kind) : formatSourceStatus(kind, source, state)}
                  >
                    {getSourceActionLabel(kind)}
                  </button>
                  {running ? (
                    <button
                      type="button"
                      onClick={() => cancelAnalysis(kind)}
                      data-testid={`ideals-cancel-${kind}`}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {state.status === 'error' || state.status === 'cancelled' ? (
                    <button
                      type="button"
                      disabled={!source}
                      onClick={() => void startAnalysis(kind, true)}
                      data-testid={`ideals-retry-${kind}`}
                    >
                      Retry
                    </button>
                  ) : null}
                  {state.result || state.status === 'error' || state.status === 'cancelled' ? (
                    <button
                      type="button"
                      onClick={() => clearSource(kind)}
                      data-testid={`ideals-clear-${kind}`}
                    >
                      Clear
                    </button>
                  ) : null}
                </span>
              );
            })}
            <button
              type="button"
              disabled={(!mixSource && !referenceSource) || anyRunning}
              onClick={startAll}
              data-testid="ideals-separate-all"
            >
              Stem Separate Both
            </button>
          </div>
        </div>

        <div className="ideals-status-strip" aria-label="Ideals source status">
          {(['mix', 'reference'] as const).map((kind) => (
            <div key={kind} className={`ideals-source-status ideals-source-status--${kind}`}>
              <strong>{getSourceLabel(kind)}:</strong>{' '}
              <span>{formatSourceStatus(kind, sources[kind], sourceStates[kind])}</span>
              {sources[kind]?.fileName ? <em>{sources[kind]?.fileName}</em> : null}
            </div>
          ))}
        </div>

        <div className="ideals-body">
          <section className="ideals-intro" data-testid="ideals-intro">
            <h3>How to use this</h3>
            <p>
              Start with the ideal curve to learn each stem’s role. Run yours and/or the
              reference to add real per-stem proxy curves, then audition the generated stem
              slots. Amber is reference, blue is your mix; compare shapes, then listen before
              making EQ moves.
            </p>
            <p className="ideals-provider-note">
              Current provider: Web Audio proxy stems — fast local approximation, cached by
              path/URL/name/size/mtime/version/reference identity. It is not ML-grade source
              separation, so treat the audio as a diagnostic audition layer rather than a clean stem export.
            </p>
          </section>

          <div className="ideals-stem-grid" data-testid="ideals-stem-grid">
            {IDEAL_STEM_IDS.map((stemId) => {
              const guide = IDEAL_STEM_GUIDES[stemId];
              const expanded = expandedByStem[stemId];
              const mixCurve = sourceStates.mix.result?.stems[stemId]?.curve;
              const referenceCurve = sourceStates.reference.result?.stems[stemId]?.curve;
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

                  <div className="ideals-curve-legend" aria-label={`${guide.label} curve legend`}>
                    <span className="ideals-legend-item ideals-legend-item--ideal">Ideal</span>
                    <span className="ideals-legend-item ideals-legend-item--mix">Your Mix</span>
                    <span className="ideals-legend-item ideals-legend-item--reference">Reference</span>
                  </div>

                  <IdealsCurveGraph
                    idealCurve={curvesByStem[stemId]}
                    mixCurve={mixCurve}
                    referenceCurve={referenceCurve}
                    guide={guide}
                    showIdeal={layers.ideal}
                    showMix={layers.mix && mixReady}
                    showReference={layers.reference && referenceReady}
                  />

                  <div className="ideals-stem-slots" aria-label={`${guide.label} stem slots`}>
                    <StemSlot kind="mix" stemId={stemId} state={sourceStates.mix} source={mixSource} />
                    <StemSlot
                      kind="reference"
                      stemId={stemId}
                      state={sourceStates.reference}
                      source={referenceSource}
                    />
                  </div>

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
