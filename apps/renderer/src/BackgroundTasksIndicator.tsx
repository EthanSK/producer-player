// Item #14 (v3.118) — Background tasks indicator.
//
// Compact Rekordbox-style pill that lives in the status sidebar header,
// next to "Status". Renders a spinner + count of in-flight + queued audio
// analysis jobs. v3.141 split the product invariant: startup/background
// warmup is measured ffmpeg analysis for LUFS/stats/normalization; WebAudio
// preview decode is lazy/user-requested for waveform and graph UI. The pill
// still counts both queues when either is active so users can see real work.
//
// Polling is preferred over a subscription because:
//   - the queues live in module-level singletons used across many call
//     sites; wiring per-callsite events would be invasive
//   - a 500ms refresh tick is plenty for a passive indicator
//   - polling stops once the indicator unmounts
//
// Stats source:
//   - dumpPreviewAnalysisQueue() — preview WAV decoder
//   - measured queue dump passed via prop (App.tsx owns the singleton)
//
// v3.145 — the popover now lists the jobs currently running in both queues
//   and the user-facing pause/resume control is gone. The legacy persisted
//   `agentBackgroundPrecomputeEnabled=false` flag is ignored by App.tsx so a
//   stale paused state can no longer hide/start-stop warmup by accident.
//
// v3.152 — startup latest-track warmup intentionally admits only one measured
//   ffmpeg job at a time, but the whole album is planned up front. Surface that
//   planned per-track backlog here so the UI does not make the album warmup
//   look like one mysterious hidden job.
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { dumpPreviewAnalysisQueue } from './audioAnalysis';
import {
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_NEIGHBOR,
  ANALYSIS_PRIORITY_USER_SELECTED,
  type AnalysisPriority,
  type AnalysisQueueJobSnapshot,
} from './audioAnalysisQueue';

type QueueDump = ReturnType<typeof dumpPreviewAnalysisQueue>;

export interface WarmupPlanSnapshot {
  total: number;
  completed: number;
  activeLabel: string | null;
  nextLabels: string[];
}

const EMPTY_WARMUP_PLAN: WarmupPlanSnapshot = {
  total: 0,
  completed: 0,
  activeLabel: null,
  nextLabels: [],
};

export interface BackgroundTasksIndicatorProps {
  /**
   * Function returning the measured queue dump. Passed in (rather than
   * imported) because the measured queue lives in App.tsx — keeps
   * audioAnalysisQueue.ts decoupled from renderer state.
   */
  getMeasuredDump: () => QueueDump;
  /**
   * Function returning the planned latest-track warmup backlog. These entries
   * are intentionally not all enqueued into the shared analysis queue at once,
   * but they are still user-visible background work.
   */
  getWarmupPlan?: () => WarmupPlanSnapshot;
}

export interface BackgroundTaskRunningJob {
  queue: 'Measured' | 'Preview';
  key: string | null;
  priority: AnalysisPriority;
  label: string | null;
  slot: AnalysisQueueJobSnapshot['slot'];
}

interface AggregateSnapshot {
  active: number;
  pending: number;
  bgPending: number;
  plannedWarmupPending: number;
  plannedWarmupTotal: number;
  plannedWarmupCompleted: number;
  plannedWarmupActiveLabel: string | null;
  plannedWarmupNextLabels: string[];
  runningJobs: BackgroundTaskRunningJob[];
}

function priorityLabel(priority: AnalysisPriority): string {
  if (priority === ANALYSIS_PRIORITY_USER_SELECTED) {
    return 'selected';
  }
  if (priority === ANALYSIS_PRIORITY_NEIGHBOR) {
    return 'warmup';
  }
  if (priority === ANALYSIS_PRIORITY_BACKGROUND) {
    return 'background';
  }
  return `priority ${priority}`;
}

function compactFallbackKey(key: string | null): string | null {
  if (!key) {
    return null;
  }

  const filename = key.split(/[\\/]/).filter(Boolean).pop();
  const fallback = filename && filename.length > 0 ? filename : key;
  return fallback.length > 72 ? `${fallback.slice(0, 69)}…` : fallback;
}

function jobDisplayName(job: BackgroundTaskRunningJob): string {
  const label = job.label?.trim();
  if (label) {
    return label;
  }
  return compactFallbackKey(job.key) ?? 'unlabelled analysis job';
}

export function formatBackgroundTaskRunningJob(
  job: BackgroundTaskRunningJob
): string {
  return `${job.queue}: ${jobDisplayName(job)} (${priorityLabel(job.priority)})`;
}

function collectRunningJobs(
  queue: BackgroundTaskRunningJob['queue'],
  dump: QueueDump
): BackgroundTaskRunningJob[] {
  return dump.runningJobs.map((job) => ({
    queue,
    key: job.key,
    priority: job.priority,
    label: job.label,
    slot: job.slot,
  }));
}

function runningJobSignature(jobs: BackgroundTaskRunningJob[]): string {
  return jobs
    .map(
      (job) =>
        `${job.queue}:${job.slot}:${job.priority}:${job.label ?? ''}:${job.key ?? ''}`
    )
    .join('|');
}

function snapshotsEqual(left: AggregateSnapshot, right: AggregateSnapshot): boolean {
  return (
    left.active === right.active &&
    left.pending === right.pending &&
    left.bgPending === right.bgPending &&
    left.plannedWarmupPending === right.plannedWarmupPending &&
    left.plannedWarmupTotal === right.plannedWarmupTotal &&
    left.plannedWarmupCompleted === right.plannedWarmupCompleted &&
    left.plannedWarmupActiveLabel === right.plannedWarmupActiveLabel &&
    left.plannedWarmupNextLabels.join('|') === right.plannedWarmupNextLabels.join('|') &&
    runningJobSignature(left.runningJobs) === runningJobSignature(right.runningJobs)
  );
}

export function getWarmupPlanPending(plan: WarmupPlanSnapshot): number {
  const safeTotal = Math.max(0, Math.floor(plan.total));
  const safeCompleted = Math.min(safeTotal, Math.max(0, Math.floor(plan.completed)));
  const activeOffset = plan.activeLabel ? 1 : 0;
  return Math.max(0, safeTotal - safeCompleted - activeOffset);
}

function aggregate(
  preview: QueueDump,
  measured: QueueDump,
  warmupPlan: WarmupPlanSnapshot
): AggregateSnapshot {
  const plannedWarmupPending = getWarmupPlanPending(warmupPlan);
  const active =
    preview.active + preview.userBypassActive + measured.active + measured.userBypassActive;
  const pending = preview.pending + measured.pending + plannedWarmupPending;
  const bgPending =
    preview.pendingByPriority.background + measured.pendingByPriority.background;
  const runningJobs = [
    ...collectRunningJobs('Measured', measured),
    ...collectRunningJobs('Preview', preview),
  ];
  return {
    active,
    pending,
    bgPending,
    plannedWarmupPending,
    plannedWarmupTotal: Math.max(0, Math.floor(warmupPlan.total)),
    plannedWarmupCompleted: Math.max(0, Math.floor(warmupPlan.completed)),
    plannedWarmupActiveLabel: warmupPlan.activeLabel,
    plannedWarmupNextLabels: [...warmupPlan.nextLabels],
    runningJobs,
  };
}

const POLL_INTERVAL_MS = 500;
const POPOVER_MAX_WIDTH_PX = 520;
const POPOVER_VIEWPORT_MARGIN_PX = 12;
const MAX_RUNNING_JOBS_SHOWN = 5;

export function BackgroundTasksIndicator(
  props: BackgroundTasksIndicatorProps
): JSX.Element | null {
  const { getMeasuredDump, getWarmupPlan } = props;
  const [snapshot, setSnapshot] = useState<AggregateSnapshot>(() =>
    aggregate(
      dumpPreviewAnalysisQueue(),
      getMeasuredDump(),
      getWarmupPlan?.() ?? EMPTY_WARMUP_PLAN
    )
  );
  // v3.121 (Concern 1) — popover visibility. Driven by mouseenter/leave
  // on the pill PLUS focus/blur on the focusable children so keyboard-only
  // users can tab into it. Esc closes when open.
  const [popoverOpen, setPopoverOpen] = useState(false);
  // v3.127 — fixed-position popover escapes the clipped sidebar panel and
  // can be wide enough for the explanatory text.
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  const updatePopoverPosition = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
    const popoverWidth = Math.min(
      POPOVER_MAX_WIDTH_PX,
      Math.max(0, viewportWidth - POPOVER_VIEWPORT_MARGIN_PX * 2)
    );
    const maxLeft = Math.max(
      POPOVER_VIEWPORT_MARGIN_PX,
      viewportWidth - popoverWidth - POPOVER_VIEWPORT_MARGIN_PX
    );
    setPopoverPosition({
      left: Math.min(Math.max(POPOVER_VIEWPORT_MARGIN_PX, rect.left), maxLeft),
      top: rect.bottom + 6,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) {
        return;
      }
      const next = aggregate(
        dumpPreviewAnalysisQueue(),
        getMeasuredDump(),
        getWarmupPlan?.() ?? EMPTY_WARMUP_PLAN
      );
      setSnapshot((previous) => (snapshotsEqual(previous, next) ? previous : next));
    };

    tick();
    const handle = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [getMeasuredDump, getWarmupPlan]);

  // v3.121 (Concern 1) — Esc dismisses the popover (only when open).
  // Capture-phase + stopPropagation matches HelpTooltip / TechnicalInfoPopover
  // so a parent overlay's Esc handler (e.g. fullscreen mastering) doesn't
  // also fire.
  useEffect(() => {
    if (!popoverOpen) {
      setPopoverPosition(null);
      return;
    }
    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setPopoverOpen(false);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [popoverOpen, updatePopoverPosition]);

  const handleMouseEnter = useCallback(() => setPopoverOpen(true), []);
  const handleMouseLeave = useCallback((event: React.MouseEvent) => {
    // Don't close when the cursor moves between sibling children (dot, label,
    // popover itself). Only close when leaving the pill.
    const related = event.relatedTarget as Node | null;
    if (
      related &&
      containerRef.current &&
      containerRef.current.contains(related)
    ) {
      return;
    }
    setPopoverOpen(false);
  }, []);
  const handleFocusCapture = useCallback(() => setPopoverOpen(true), []);
  const handleBlurCapture = useCallback((event: React.FocusEvent) => {
    const related = event.relatedTarget as Node | null;
    if (
      related &&
      containerRef.current &&
      containerRef.current.contains(related)
    ) {
      return;
    }
    setPopoverOpen(false);
  }, []);

  const idle = snapshot.active === 0 && snapshot.pending === 0;
  if (idle) {
    return null;
  }

  // v3.121 (Concern 1) — short native title kept as a fallback for
  // screenreaders / touch users who can't hover. The full explanation
  // lives in the popover below.
  const tooltip =
    `Audio analysis: ${snapshot.active} processing` +
    (snapshot.pending > 0 ? `, ${snapshot.pending} waiting/planned` : '') +
    '. Hover for details.';
  const popoverStyle: CSSProperties | undefined = popoverPosition
    ? {
        left: popoverPosition.left,
        top: popoverPosition.top,
      }
    : undefined;
  const visibleRunningJobs = snapshot.runningJobs.slice(0, MAX_RUNNING_JOBS_SHOWN);
  const hiddenRunningJobCount = Math.max(
    0,
    snapshot.runningJobs.length - visibleRunningJobs.length
  );

  return (
    <span
      ref={containerRef}
      className="bg-tasks-indicator"
      role="status"
      aria-live="polite"
      title={tooltip}
      data-testid="bg-tasks-indicator"
      data-popover-open={popoverOpen ? 'true' : 'false'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <span className="bg-tasks-indicator-dot" aria-hidden="true" />
      <span className="bg-tasks-indicator-label">
        {`${snapshot.active > 0 ? snapshot.active : '·'}${
          snapshot.pending > 0 ? ` / ${snapshot.pending}` : ''
        }`}
      </span>
      {popoverOpen && popoverStyle ? (
        <span
          className="bg-tasks-indicator-popover"
          role="tooltip"
          data-testid="bg-tasks-indicator-popover"
          style={popoverStyle}
        >
          <span className="bg-tasks-indicator-popover-title">
            Audio analysis work
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Active / queued:
            </strong>{' '}
            {`${snapshot.active} job${snapshot.active === 1 ? '' : 's'} running, ${snapshot.pending} waiting/planned.`}
          </span>
          {snapshot.plannedWarmupTotal > 0 ? (
            <span className="bg-tasks-indicator-popover-row">
              <strong className="bg-tasks-indicator-popover-row-label">
                Startup warmup:
              </strong>{' '}
              {`${snapshot.plannedWarmupCompleted}/${snapshot.plannedWarmupTotal} tracks complete`}
              {snapshot.plannedWarmupActiveLabel
                ? `; warming ${snapshot.plannedWarmupActiveLabel}`
                : snapshot.plannedWarmupPending > 0
                  ? `; ${snapshot.plannedWarmupPending} planned next`
                  : '; complete'}
              {snapshot.plannedWarmupNextLabels.length > 0 ? (
                <span className="bg-tasks-indicator-job-list">
                  {snapshot.plannedWarmupNextLabels.map((label, index) => (
                    <span
                      key={`${label}-${index}`}
                      className="bg-tasks-indicator-job bg-tasks-indicator-job-muted"
                    >
                      Next: {label}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Warmup scheduling:
            </strong>{' '}
            latest-track warmup is planned per track but admitted to ffmpeg
            one at a time so selected tracks can still jump the line.
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Running now:
            </strong>{' '}
            {visibleRunningJobs.length > 0 ? (
              <span className="bg-tasks-indicator-job-list">
                {visibleRunningJobs.map((job, index) => (
                  <span
                    key={`${job.queue}-${job.key ?? job.label ?? index}-${index}`}
                    className="bg-tasks-indicator-job"
                  >
                    {formatBackgroundTaskRunningJob(job)}
                  </span>
                ))}
                {hiddenRunningJobCount > 0 ? (
                  <span className="bg-tasks-indicator-job bg-tasks-indicator-job-muted">
                    +{hiddenRunningJobCount} more
                  </span>
                ) : null}
              </span>
            ) : (
              'No job is actively running yet; the next queued item will start when a slot opens.'
            )}
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Active:
            </strong>{' '}
            ffmpeg measured-analysis jobs plus any lazy WAV-decode preview
            jobs in flight (includes any user-priority bypass slots).
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Queued:
            </strong>{' '}
            jobs waiting for an open slot, plus planned startup warmup tracks
            that have not been admitted to the ffmpeg queue yet. Clicking a
            track jumps the queue (user-priority bypasses up to 3 background
            jobs so a click never stalls behind precompute).
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Stuck job?
            </strong>{' '}
            Each job has a 60-second wall-clock timeout. If ffmpeg or a lazy
            WAV preview decode hangs, the queue gives up, frees the slot, and
            the track shows an error rather than spinning forever.
          </span>
        </span>
      ) : null}
    </span>
  );
}
