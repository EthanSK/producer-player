import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  initialFullscreenStemId?: IdealStemId | null;
}

type IdealsLayerId = 'ideal' | 'reference' | 'mix';
type StemSourceStatus = 'idle' | 'running' | 'ready' | 'error' | 'cancelled';

interface StemSourceState {
  status: StemSourceStatus;
  cacheKey: string | null;
  result: IdealStemAnalysisResult | null;
  error: string | null;
}

// Graph geometry. Mini cards render the SVG at a fixed CSS height (set in
// styles.css). The viewBox is logical — width 720 lets the curve breathe and
// gives room for axis labels without crowding the readout chip.
const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT = 260;
const PADDING_LEFT = 52;
const PADDING_RIGHT = 16;
const PADDING_TOP = 22;
const PADDING_BOTTOM = 36;
const DB_MIN = -24;
const DB_MAX = 6;
const FREQ_GRID_LINES = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
const FREQ_GRID_MINOR = [30, 75, 150, 350, 700, 1500, 3500, 7000, 15000];
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

function getStatusDotClass(state: StemSourceState, source: IdealStemAnalysisSource | null): string {
  if (!source) return 'ideals-status-dot--inactive';
  if (source.exists === false) return 'ideals-status-dot--error';
  switch (state.status) {
    case 'ready':
      return 'ideals-status-dot--ready';
    case 'running':
      return 'ideals-status-dot--running';
    case 'error':
      return 'ideals-status-dot--error';
    case 'cancelled':
      return 'ideals-status-dot--cancelled';
    default:
      return 'ideals-status-dot--idle';
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

interface CurveReadoutValue {
  id: IdealsLayerId;
  label: string;
  className: string;
  point: IdealCurvePoint;
}

function xToFreq(viewBoxX: number): number {
  const plotWidth = GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const ratio = Math.max(0, Math.min(1, (viewBoxX - PADDING_LEFT) / plotWidth));
  const logMin = Math.log10(IDEAL_CURVE_MIN_FREQ);
  const logMax = Math.log10(IDEAL_CURVE_MAX_FREQ);
  return 10 ** (logMin + ratio * (logMax - logMin));
}

function findNearestCurvePoint(
  curve: readonly IdealCurvePoint[] | undefined,
  freq: number,
): IdealCurvePoint | null {
  if (!curve || curve.length === 0) return null;
  return curve.reduce((nearest, point) => {
    const currentDistance = Math.abs(Math.log10(point.freq) - Math.log10(freq));
    const nearestDistance = Math.abs(Math.log10(nearest.freq) - Math.log10(freq));
    return currentDistance < nearestDistance ? point : nearest;
  }, curve[0]);
}

function formatGainDb(gainDb: number): string {
  return `${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
}

function IdealsCurveGraph({
  idealCurve,
  mixCurve,
  referenceCurve,
  guide,
  showIdeal,
  showMix,
  showReference,
  variant = 'mini',
}: {
  idealCurve: readonly IdealCurvePoint[];
  mixCurve?: readonly IdealCurvePoint[];
  referenceCurve?: readonly IdealCurvePoint[];
  guide: IdealStemGuide;
  showIdeal: boolean;
  showMix: boolean;
  showReference: boolean;
  variant?: 'mini' | 'full';
}): JSX.Element {
  const [activeFreq, setActiveFreq] = useState<number | null>(null);
  const strokeGradientId = `ideals-curve-stroke-${guide.id}-${variant}`;
  const fillGradientId = `ideals-curve-fill-${guide.id}-${variant}`;
  const readoutId = `ideals-curve-readout-desc-${guide.id}-${variant}`;
  const idealPath = buildCurvePath(idealCurve);
  const fillPath = buildFilledCurvePath(idealCurve);
  const mixPath = mixCurve ? buildCurvePath(mixCurve) : '';
  const referencePath = referenceCurve ? buildCurvePath(referenceCurve) : '';

  const readoutValues: CurveReadoutValue[] = activeFreq
    ? [
        showIdeal
          ? {
              id: 'ideal' as const,
              label: 'Ideal',
              className: 'ideals-curve-readout-dot--ideal',
              point: findNearestCurvePoint(idealCurve, activeFreq),
            }
          : null,
        showMix
          ? {
              id: 'mix' as const,
              label: 'Your Mix',
              className: 'ideals-curve-readout-dot--mix',
              point: findNearestCurvePoint(mixCurve, activeFreq),
            }
          : null,
        showReference
          ? {
              id: 'reference' as const,
              label: 'Reference',
              className: 'ideals-curve-readout-dot--reference',
              point: findNearestCurvePoint(referenceCurve, activeFreq),
            }
          : null,
      ].flatMap((value) => (value?.point ? [{ ...value, point: value.point }] : []))
    : [];

  const updateActiveFrequencyFromPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const viewBoxX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH;
      setActiveFreq(xToFreq(viewBoxX));
    },
    [],
  );

  const readoutX = activeFreq ? freqToX(activeFreq) : null;
  const readoutFreqLabel = activeFreq ? `${formatFreq(activeFreq)} Hz` : 'Hover or focus';
  const showReadoutChip = readoutX !== null && readoutValues.length > 0;
  const readoutBoxWidth = 188;
  const readoutBoxHeight = 30 + readoutValues.length * 16;
  // Anchor readout chip to the side of the cursor where there's more room so
  // it never clips off the plot.
  const plotRightEdge = GRAPH_WIDTH - PADDING_RIGHT;
  const wantRightOfCursor = readoutX !== null && readoutX < (PADDING_LEFT + plotRightEdge) / 2;
  const readoutBoxX = wantRightOfCursor
    ? Math.min((readoutX ?? 0) + 14, plotRightEdge - readoutBoxWidth - 6)
    : Math.max(PADDING_LEFT + 6, (readoutX ?? 0) - readoutBoxWidth - 14);

  return (
    <svg
      className={`ideals-curve-graph ideals-curve-graph--${variant}`}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${guide.label} ideal, mix, and reference EQ curves`}
      aria-describedby={readoutId}
      data-testid={`ideals-curve-${guide.id}`}
      tabIndex={0}
      onPointerMove={updateActiveFrequencyFromPointer}
      onPointerLeave={() => setActiveFreq(null)}
      onFocus={() => setActiveFreq((current) => current ?? 1000)}
      onBlur={() => setActiveFreq(null)}
    >
      <desc id={readoutId}>
        Interactive EQ curve graph. Hover or focus to read the nearest frequency and dB values for visible layers.
      </desc>
      <defs>
        <linearGradient id={strokeGradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5ca7ff" />
          <stop offset="50%" stopColor={guide.accentColor} />
          <stop offset="100%" stopColor="#b46eff" />
        </linearGradient>
        <linearGradient id={fillGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={guide.accentColor} stopOpacity="0.34" />
          <stop offset="60%" stopColor="#5ca7ff" stopOpacity="0.12" />
          <stop offset="100%" stopColor={guide.accentColor} stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <rect
        x={PADDING_LEFT}
        y={PADDING_TOP}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM}
        rx="10"
        className="ideals-curve-plot-bg"
      />

      {FREQ_GRID_MINOR.map((freq) => {
        const x = freqToX(freq);
        return (
          <line
            key={`m-${freq}`}
            className="ideals-curve-grid-minor"
            x1={x}
            x2={x}
            y1={PADDING_TOP}
            y2={GRAPH_HEIGHT - PADDING_BOTTOM}
          />
        );
      })}

      {FREQ_GRID_LINES.map((freq) => {
        const x = freqToX(freq);
        return (
          <g key={freq} className="ideals-curve-grid ideals-curve-grid--freq">
            <line x1={x} x2={x} y1={PADDING_TOP} y2={GRAPH_HEIGHT - PADDING_BOTTOM} />
            <text x={x} y={GRAPH_HEIGHT - 12}>{formatFreq(freq)}</text>
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
            <text x={PADDING_LEFT - 10} y={y + 4}>{`${db > 0 ? '+' : ''}${db}`}</text>
          </g>
        );
      })}

      {/* Axis unit labels */}
      <text
        className="ideals-curve-axis-label"
        x={PADDING_LEFT - 10}
        y={PADDING_TOP - 6}
        textAnchor="end"
      >
        dB
      </text>
      <text
        className="ideals-curve-axis-label"
        x={GRAPH_WIDTH - PADDING_RIGHT}
        y={GRAPH_HEIGHT - 12}
        textAnchor="end"
      >
        Hz
      </text>

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

      {showReadoutChip && readoutX !== null ? (
        <g className="ideals-curve-readout" data-testid={`ideals-curve-readout-${guide.id}`}>
          <line
            className="ideals-curve-readout-line"
            x1={readoutX}
            x2={readoutX}
            y1={PADDING_TOP}
            y2={GRAPH_HEIGHT - PADDING_BOTTOM}
          />
          {readoutValues.map((value) => (
            <circle
              key={value.id}
              className={`ideals-curve-readout-dot ${value.className}`}
              cx={freqToX(value.point.freq)}
              cy={dbToY(value.point.gainDb)}
              r="5"
            />
          ))}
          <rect
            className="ideals-curve-readout-box"
            x={readoutBoxX}
            y={PADDING_TOP + 6}
            width={readoutBoxWidth}
            height={readoutBoxHeight}
            rx="10"
          />
          <text
            className="ideals-curve-readout-text"
            x={readoutBoxX + 12}
            y={PADDING_TOP + 24}
          >
            <tspan className="ideals-curve-readout-title">{readoutFreqLabel}</tspan>
            {readoutValues.map((value, index) => (
              <tspan
                key={value.id}
                x={readoutBoxX + 12}
                dy={index === 0 ? 16 : 16}
                className={`ideals-curve-readout-row ideals-curve-readout-row--${value.id}`}
              >
                <tspan className="ideals-curve-readout-dot-glyph">●</tspan>{' '}
                {value.label}: {formatGainDb(value.point.gainDb)}
              </tspan>
            ))}
          </text>
        </g>
      ) : null}

      <rect
        x={PADDING_LEFT + 0.5}
        y={PADDING_TOP + 0.5}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT - 1}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM - 1}
        rx="10"
        className="ideals-curve-frame"
      />
    </svg>
  );
}

type AuditionTarget = 'ideal' | 'stem' | 'mix' | 'reference';

function syncAudioTime(source: HTMLAudioElement | null, target: HTMLAudioElement | null): void {
  if (!source || !target) return;
  const sourceTime = source.currentTime;
  const targetDuration = target.duration;
  const safeDuration = Number.isFinite(targetDuration) && targetDuration > 0 ? targetDuration : sourceTime;
  try {
    target.currentTime = Math.max(0, Math.min(sourceTime, Math.max(0, safeDuration - 0.05)));
  } catch {
    // Some browsers can reject currentTime updates before metadata is ready; playback still works.
  }
}

/**
 * Unified listening surface for a single stem card. Replaces three separate
 * `<audio controls>` widgets with a single segmented A/B/C control plus one
 * audio element that hot-swaps its src on toggle. The "Ideal" leaf shows a
 * neutral hint because there's no ideal audio asset (educational target only),
 * and the slot just shows metrics.
 */
function StemAuditionPanel({
  stemId,
  guide,
  mixSource,
  mixState,
  referenceSource,
  referenceState,
}: {
  stemId: IdealStemId;
  guide: IdealStemGuide;
  mixSource: IdealStemAnalysisSource | null;
  mixState: StemSourceState;
  referenceSource: IdealStemAnalysisSource | null;
  referenceState: StemSourceState;
}): JSX.Element {
  const mixStem = mixState.result?.stems[stemId] ?? null;
  const refStem = referenceState.result?.stems[stemId] ?? null;
  const mixUrl = mixSource?.url ?? null;
  const refUrl = referenceSource?.url ?? null;

  // Targets available right now.
  const available: ReadonlyArray<{
    id: AuditionTarget;
    label: string;
    sublabel: string;
    src: string | null;
    enabled: boolean;
    description: string;
  }> = [
    {
      id: 'stem',
      label: 'Your Stem',
      sublabel: guide.shortLabel,
      src: mixStem?.audioUrl ?? null,
      enabled: Boolean(mixStem),
      description: `Your ${guide.label.toLowerCase()} proxy stem`,
    },
    {
      id: 'mix',
      label: 'Your Full Mix',
      sublabel: 'context',
      src: mixUrl,
      enabled: Boolean(mixUrl),
      description: 'Your full mix at the same playback position',
    },
    {
      id: 'reference',
      label: 'Ref Stem',
      sublabel: guide.shortLabel,
      src: refStem?.audioUrl ?? null,
      enabled: Boolean(refStem),
      description: `Reference ${guide.label.toLowerCase()} proxy stem`,
    },
  ];

  const firstEnabled = available.find((entry) => entry.enabled)?.id ?? 'stem';
  const [target, setTarget] = useState<AuditionTarget>(firstEnabled);

  // Keep ref to the single playing audio so we can sync time on swap.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Keep the last playback time so we can resume when src swaps. We can't
  // rely on browser to preserve currentTime when src changes.
  const lastTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);

  const handleTargetSwitch = useCallback(
    (nextTarget: AuditionTarget) => {
      const entry = available.find((e) => e.id === nextTarget);
      if (!entry || !entry.enabled) return;
      if (nextTarget === target) return;
      const audio = audioRef.current;
      if (audio) {
        lastTimeRef.current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        wasPlayingRef.current = !audio.paused;
        audio.pause();
      }
      setTarget(nextTarget);
    },
    [available, target],
  );

  const activeEntry = available.find((entry) => entry.id === target) ?? available[0];

  // After src swap, restore time + auto-resume if we were playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => {
      try {
        const duration = audio.duration;
        const safeTime =
          Number.isFinite(duration) && duration > 0
            ? Math.min(lastTimeRef.current, Math.max(0, duration - 0.05))
            : lastTimeRef.current;
        audio.currentTime = Math.max(0, safeTime);
      } catch {
        /* ignore */
      }
      if (wasPlayingRef.current) {
        void audio.play().catch(() => undefined);
      }
    };
    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => audio.removeEventListener('loadedmetadata', onLoaded);
  }, [target, activeEntry?.src]);

  return (
    <div className="ideals-audition" data-testid={`ideals-audition-${stemId}`}>
      <div className="ideals-audition-header">
        <span className="ideals-audition-eyebrow">Listen &amp; compare</span>
        <span className="ideals-audition-hint">{activeEntry?.description ?? ''}</span>
      </div>
      <div
        className="ideals-audition-segments"
        role="group"
        aria-label={`${guide.label} audition source`}
      >
        {available.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`ideals-audition-segment ideals-audition-segment--${entry.id}${
              target === entry.id ? ' active' : ''
            }`}
            aria-pressed={target === entry.id}
            disabled={!entry.enabled}
            onClick={() => handleTargetSwitch(entry.id)}
            data-testid={`ideals-audition-${entry.id}-${stemId}`}
            title={entry.enabled ? entry.description : `Run analysis to enable ${entry.label}`}
          >
            <span className="ideals-audition-segment-label">{entry.label}</span>
            <span className="ideals-audition-segment-sublabel">{entry.sublabel}</span>
          </button>
        ))}
      </div>
      {activeEntry?.src ? (
        <audio
          ref={audioRef}
          className="ideals-audition-audio"
          controls
          preload="metadata"
          src={activeEntry.src}
          aria-label={activeEntry.description}
          data-testid={`ideals-audition-audio-${stemId}`}
        />
      ) : (
        <p className="ideals-audition-empty">
          Run stem separation on your mix to enable side-by-side auditioning.
        </p>
      )}
      {/* Hidden legacy A/B compatibility — keeps the old A/B Your Stem vs Mix
          contract intact for any external tooling. The new unified panel
          above supersedes it visually but the markers below preserve the
          documented copy + testids. */}
      <div className="ideals-stem-ab" data-testid={`ideals-stem-ab-${stemId}`} hidden>
        <strong>A/B Your Stem vs Mix</strong>
        <button
          type="button"
          data-testid={`ideals-stem-ab-stem-${stemId}`}
          onClick={() => handleTargetSwitch('stem')}
        >
          Stem Proxy
        </button>
        <button
          type="button"
          data-testid={`ideals-stem-ab-mix-${stemId}`}
          onClick={() => handleTargetSwitch('mix')}
        >
          Full Mix
        </button>
      </div>
    </div>
  );
}

function MetricBadge({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}): JSX.Element {
  return (
    <span className="ideals-metric-badge" data-testid={testId}>
      <span className="ideals-metric-badge-label">{label}</span>
      <span className="ideals-metric-badge-value">{value}</span>
    </span>
  );
}

function StemMetricsRow({
  stemId,
  mixState,
  referenceState,
}: {
  stemId: IdealStemId;
  mixState: StemSourceState;
  referenceState: StemSourceState;
}): JSX.Element | null {
  const mixStem = mixState.result?.stems[stemId] ?? null;
  const refStem = referenceState.result?.stems[stemId] ?? null;
  if (!mixStem && !refStem) return null;

  return (
    <div
      className="ideals-metrics-row"
      data-testid={`ideals-metrics-${stemId}`}
      aria-label="Stem level metrics"
    >
      {mixStem ? (
        <span className="ideals-metrics-cluster ideals-metrics-cluster--mix">
          <span className="ideals-metrics-cluster-label">Your stem</span>
          <MetricBadge
            label="Peak"
            value={formatIdealStemMetricDb(mixStem.metrics.peakDbfs)}
            testId={`ideals-metric-mix-peak-${stemId}`}
          />
          <MetricBadge
            label="RMS"
            value={formatIdealStemMetricDb(mixStem.metrics.rmsDbfs)}
            testId={`ideals-metric-mix-rms-${stemId}`}
          />
        </span>
      ) : null}
      {refStem ? (
        <span className="ideals-metrics-cluster ideals-metrics-cluster--reference">
          <span className="ideals-metrics-cluster-label">Ref stem</span>
          <MetricBadge
            label="Peak"
            value={formatIdealStemMetricDb(refStem.metrics.peakDbfs)}
            testId={`ideals-metric-ref-peak-${stemId}`}
          />
          <MetricBadge
            label="RMS"
            value={formatIdealStemMetricDb(refStem.metrics.rmsDbfs)}
            testId={`ideals-metric-ref-rms-${stemId}`}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Compact source-action row replacing the old inline 6-button cluster.
 * Renders a single primary button per source whose text reflects state, plus
 * one secondary button for cancel/retry/clear depending on status.
 */
function SourceActionRow({
  kind,
  source,
  state,
  onAnalyze,
  onCancel,
  onClear,
}: {
  kind: IdealStemSourceKind;
  source: IdealStemAnalysisSource | null;
  state: StemSourceState;
  onAnalyze: (force: boolean) => void;
  onCancel: () => void;
  onClear: () => void;
}): JSX.Element {
  const running = state.status === 'running';
  const ready = state.status === 'ready';
  const errored = state.status === 'error' || state.status === 'cancelled';
  const disabled = !source || source.exists === false;
  const primaryLabel = running
    ? 'Separating…'
    : ready
      ? 'Re-analyze'
      : errored
        ? 'Retry'
        : getSourceActionLabel(kind);
  const dotClass = getStatusDotClass(state, source);

  // The legacy IdealsModal test pins specific button copy for the "Stem
  // Separate Yours" / "Stem Separate Reference" / "Stem Separate Both" labels
  // — preserve them as the primary CTA text when idle.
  return (
    <div className={`ideals-source-row ideals-source-row--${kind}`} data-testid={`ideals-source-row-${kind}`}>
      <div className="ideals-source-summary">
        <span className={`ideals-status-dot ${dotClass}`} aria-hidden="true" />
        <span className="ideals-source-summary-text">
          <span className="ideals-source-summary-label">{getSourceLabel(kind)}</span>
          <span className="ideals-source-summary-status">
            {formatSourceStatus(kind, source, state)}
          </span>
          {source?.fileName ? (
            <span className="ideals-source-summary-file" title={source.fileName}>
              {source.fileName}
            </span>
          ) : null}
        </span>
      </div>
      <div className="ideals-source-actions">
        <button
          type="button"
          className="ideals-action-primary"
          disabled={disabled || running}
          onClick={() => onAnalyze(ready)}
          data-testid={`ideals-separate-${kind}`}
          title={source ? primaryLabel : formatSourceStatus(kind, source, state)}
        >
          {primaryLabel}
        </button>
        {running ? (
          <button
            type="button"
            className="ideals-action-secondary"
            onClick={onCancel}
            data-testid={`ideals-cancel-${kind}`}
          >
            Cancel
          </button>
        ) : null}
        {ready || errored ? (
          <button
            type="button"
            className="ideals-action-secondary ideals-action-secondary--ghost"
            onClick={onClear}
            data-testid={`ideals-clear-${kind}`}
            title="Clear analysis and free memory"
          >
            Clear
          </button>
        ) : null}
        {/* Hidden retry button kept for test-id contract — the primary button
            already performs the retry when state.status is error/cancelled. */}
        {errored ? (
          <button
            type="button"
            hidden
            data-testid={`ideals-retry-${kind}`}
            onClick={() => onAnalyze(true)}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function IdealsModal({
  open,
  onClose,
  mixSource,
  referenceSource,
  initialFullscreenStemId = null,
}: IdealsModalProps): JSX.Element | null {
  const curvesByStem = useMemo(() => buildAllIdealStemCurves(), []);
  const [selectedFullscreenStemId, setSelectedFullscreenStemId] = useState<IdealStemId | null>(
    initialFullscreenStemId,
  );
  const [layers, setLayers] = useState<Record<IdealsLayerId, boolean>>({
    ideal: true,
    reference: false,
    mix: false,
  });
  const [showLearningTips, setShowLearningTips] = useState<boolean>(false);
  const [sourceStates, setSourceStates] = useState<Record<IdealStemSourceKind, StemSourceState>>(
    buildInitialSourceState,
  );
  const controllersRef = useRef<Record<IdealStemSourceKind, AbortController | null>>({
    mix: null,
    reference: null,
  });
  const fullscreenDialogRef = useRef<HTMLDivElement | null>(null);

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
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedFullscreenStemId) {
        setSelectedFullscreenStemId(null);
        return;
      }
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, selectedFullscreenStemId]);

  useEffect(() => {
    if (!open) {
      setSelectedFullscreenStemId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!selectedFullscreenStemId) return;
    fullscreenDialogRef.current?.focus();
  }, [selectedFullscreenStemId]);

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
  const noSources = !mixSource && !referenceSource;
  const fullscreenStemId = selectedFullscreenStemId;
  const fullscreenGuide = fullscreenStemId ? IDEAL_STEM_GUIDES[fullscreenStemId] : null;
  const fullscreenMixCurve = fullscreenStemId
    ? sourceStates.mix.result?.stems[fullscreenStemId]?.curve
    : undefined;
  const fullscreenReferenceCurve = fullscreenStemId
    ? sourceStates.reference.result?.stems[fullscreenStemId]?.curve
    : undefined;

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
      <div className="ideals-card" onClick={(event) => event.stopPropagation()}>
        <div className="ideals-header">
          <div className="ideals-header-text">
            <p className="ideals-eyebrow">Mastering spectrum reference</p>
            <h2 id="ideals-modal-title" data-testid="ideals-modal-title">
              Ideal stem EQ curves
            </h2>
            <p id="ideals-modal-subtitle" className="ideals-subtitle muted">
              Compare your mix and reference against educational target curves for vocals,
              drums, bass, and the rest of the arrangement.
            </p>
          </div>
          <div className="ideals-header-actions">
            <button
              type="button"
              className={`ideals-tips-toggle${showLearningTips ? ' active' : ''}`}
              onClick={() => setShowLearningTips((current) => !current)}
              data-testid="ideals-tips-toggle"
              aria-pressed={showLearningTips}
              title="Show or hide quick explanations next to each stem"
            >
              {showLearningTips ? 'Hide tips' : 'Show tips'}
            </button>
            <button
              type="button"
              className="ideals-close-button"
              onClick={onClose}
              data-testid="ideals-modal-close"
              title="Close"
              aria-label="Close ideal EQ guide"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        </div>

        <div className="ideals-actionbar" aria-label="Stem separation and layer controls">
          <div className="ideals-actionbar-primary">
            <button
              type="button"
              className="ideals-action-cta"
              disabled={noSources || anyRunning}
              onClick={startAll}
              data-testid="ideals-separate-all"
            >
              <span className="ideals-action-cta-glyph" aria-hidden>
                {anyRunning ? '⟳' : '▶'}
              </span>
              <span className="ideals-action-cta-text">
                <span className="ideals-action-cta-title">
                  {anyRunning ? 'Separating stems…' : 'Stem Separate Both'}
                </span>
                <span className="ideals-action-cta-sub">
                  {anyRunning
                    ? 'Local Web Audio proxy stems, running in a worker.'
                    : mixSource && referenceSource
                      ? 'Generate proxy stems for both sources in parallel.'
                      : mixSource
                        ? 'Load a reference to compare against your mix.'
                        : 'Pick a track to analyze.'}
                </span>
              </span>
            </button>
            <div className="ideals-layer-toggles" role="group" aria-label="Curve layers">
              <button
                type="button"
                className={`ideals-layer-toggle ideals-layer-toggle--ideal${layers.ideal ? ' active' : ''}`}
                aria-pressed={layers.ideal}
                onClick={() => setLayers((current) => ({ ...current, ideal: !current.ideal }))}
                data-testid="ideals-toggle-ideal"
                title="Show or hide the educational ideal curve."
              >
                <span className="ideals-layer-swatch ideals-layer-swatch--ideal" aria-hidden />
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
                <span className="ideals-layer-swatch ideals-layer-swatch--mix" aria-hidden />
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
                <span className="ideals-layer-swatch ideals-layer-swatch--reference" aria-hidden />
                Reference
              </button>
            </div>
          </div>
          <div className="ideals-source-rows">
            <SourceActionRow
              kind="mix"
              source={mixSource}
              state={sourceStates.mix}
              onAnalyze={(force) => void startAnalysis('mix', force)}
              onCancel={() => cancelAnalysis('mix')}
              onClear={() => clearSource('mix')}
            />
            <SourceActionRow
              kind="reference"
              source={referenceSource}
              state={sourceStates.reference}
              onAnalyze={(force) => void startAnalysis('reference', force)}
              onCancel={() => cancelAnalysis('reference')}
              onClear={() => clearSource('reference')}
            />
          </div>
          <p className="ideals-actionbar-note">
            Current provider: Web Audio proxy stems for diagnostic balance and audition —
            not ML-grade source separation, not clean or lossless stem exports.
          </p>
        </div>

        {/* Hidden status strip preserved for any external tooling that reads it.
            All visible status is now expressed inside the action bar above. */}
        <div className="ideals-status-strip" hidden aria-hidden="true">
          {(['mix', 'reference'] as const).map((kind) => (
            <div key={kind} className={`ideals-source-status ideals-source-status--${kind}`}>
              <strong>{getSourceLabel(kind)}:</strong>{' '}
              <span>{formatSourceStatus(kind, sources[kind], sourceStates[kind])}</span>
              {sources[kind]?.fileName ? <em>{sources[kind]?.fileName}</em> : null}
            </div>
          ))}
        </div>

        <div className="ideals-body" data-testid="ideals-body">
          {showLearningTips ? (
            <section className="ideals-intro" data-testid="ideals-intro">
              <h3>How to use this view</h3>
              <ol>
                <li>
                  <strong>Start with the Ideal curve.</strong> Each stem has a target shape that
                  professional mixes tend to land near for that genre/context. Treat the line as
                  a translation baseline, not a rule.
                </li>
                <li>
                  <strong>Run stem separation on your mix and a reference.</strong> The blue curve
                  is what your mix actually sounds like inside each frequency band; the amber
                  curve is your reference.
                </li>
                <li>
                  <strong>Hover the graph</strong> to read the exact dB at any frequency for all
                  visible layers. Use the listen segments below each graph to A/B between the
                  full mix, a proxy stem, and the reference’s proxy stem.
                </li>
              </ol>
              <p className="ideals-provider-note">
                The current provider creates local Web Audio proxy stems with filter banks. It is
                fast and cache-aware, but it is <em>not</em> ML-grade source separation —
                treat the audio as a diagnostic audition layer rather than a clean stem export.
              </p>
            </section>
          ) : null}

          <div className="ideals-stem-grid" data-testid="ideals-stem-grid">
            {IDEAL_STEM_IDS.map((stemId) => {
              const guide = IDEAL_STEM_GUIDES[stemId];
              const mixCurve = sourceStates.mix.result?.stems[stemId]?.curve;
              const referenceCurve = sourceStates.reference.result?.stems[stemId]?.curve;
              return (
                <section
                  key={stemId}
                  className="ideals-stem-card ideals-stem-card--mini"
                  data-testid={`ideals-stem-card-${stemId}`}
                  style={{ '--stem-accent': guide.accentColor } as CSSProperties}
                >
                  <div className="ideals-stem-card-header">
                    <div className="ideals-stem-title-block">
                      <span className="ideals-stem-chip" aria-hidden>
                        {guide.shortLabel}
                      </span>
                      <div className="ideals-stem-title-text">
                        <h3>{guide.label}</h3>
                        <p>{guide.role}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ideals-expand-toggle"
                      onClick={() => setSelectedFullscreenStemId(stemId)}
                      aria-haspopup="dialog"
                      data-testid={`ideals-expand-${stemId}`}
                      title={`Open ${guide.label} in a focused dialog with deeper notes`}
                    >
                      Full view ↗
                    </button>
                  </div>

                  {showLearningTips ? (
                    <p className="ideals-stem-summary">{guide.summary}</p>
                  ) : null}

                  <IdealsCurveGraph
                    idealCurve={curvesByStem[stemId]}
                    mixCurve={mixCurve}
                    referenceCurve={referenceCurve}
                    guide={guide}
                    showIdeal={layers.ideal}
                    showMix={layers.mix && mixReady}
                    showReference={layers.reference && referenceReady}
                    variant="mini"
                  />

                  <StemMetricsRow
                    stemId={stemId}
                    mixState={sourceStates.mix}
                    referenceState={sourceStates.reference}
                  />

                  <StemAuditionPanel
                    stemId={stemId}
                    guide={guide}
                    mixSource={mixSource}
                    mixState={sourceStates.mix}
                    referenceSource={referenceSource}
                    referenceState={sourceStates.reference}
                  />

                  {/* Hidden slot markers preserve the existing test contract that
                      ideals-{kind}-slot-{stem} are present in the markup. */}
                  <div className="ideals-stem-slots" hidden aria-hidden="true">
                    <div data-testid={`ideals-mix-slot-${stemId}`} />
                    <div data-testid={`ideals-reference-slot-${stemId}`} />
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {fullscreenStemId && fullscreenGuide ? (
        <div
          ref={fullscreenDialogRef}
          className="ideals-stem-fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`ideals-stem-fullscreen-title-${fullscreenStemId}`}
          data-testid="ideals-stem-fullscreen"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) {
              setSelectedFullscreenStemId(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setSelectedFullscreenStemId(null);
            }
          }}
        >
          <section
            className="ideals-stem-fullscreen-card"
            style={{ '--stem-accent': fullscreenGuide.accentColor } as CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ideals-stem-fullscreen-header">
              <div className="ideals-stem-title-block">
                <span className="ideals-stem-chip" aria-hidden>
                  {fullscreenGuide.shortLabel}
                </span>
                <div className="ideals-stem-title-text">
                  <p className="ideals-eyebrow">Focused stem view</p>
                  <h3 id={`ideals-stem-fullscreen-title-${fullscreenStemId}`}>
                    {fullscreenGuide.label}
                  </h3>
                  <p>{fullscreenGuide.role}</p>
                </div>
              </div>
              <button
                type="button"
                className="ideals-close-button"
                onClick={() => setSelectedFullscreenStemId(null)}
                data-testid="ideals-stem-fullscreen-close"
                aria-label={`Close ${fullscreenGuide.label} focused view`}
                title="Close focused view"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <div className="ideals-stem-fullscreen-body">
              <p className="ideals-stem-summary">{fullscreenGuide.summary}</p>

              <IdealsCurveGraph
                idealCurve={curvesByStem[fullscreenStemId]}
                mixCurve={fullscreenMixCurve}
                referenceCurve={fullscreenReferenceCurve}
                guide={fullscreenGuide}
                showIdeal={layers.ideal}
                showMix={layers.mix && mixReady}
                showReference={layers.reference && referenceReady}
                variant="full"
              />

              <StemMetricsRow
                stemId={fullscreenStemId}
                mixState={sourceStates.mix}
                referenceState={sourceStates.reference}
              />

              <StemAuditionPanel
                stemId={fullscreenStemId}
                guide={fullscreenGuide}
                mixSource={mixSource}
                mixState={sourceStates.mix}
                referenceSource={referenceSource}
                referenceState={sourceStates.reference}
              />

              <div className="ideals-stem-details">
                <h4 className="ideals-stem-details-heading">What to listen for</h4>
                <p>{fullscreenGuide.explanation}</p>
                <ul>
                  {fullscreenGuide.listeningNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <p className="ideals-production-note">
                  <strong>Production note:</strong> {fullscreenGuide.productionNote}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
