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
// v3.120 (Item #14 follow-up) — pause/stop button next to the pill.
//   Clicking flips `agentBackgroundPrecomputeEnabled` in user state. When
//   paused: the pill stays mounted (so the button is always reachable) and
//   renders in a muted "paused" treatment with a "paused" label. Optional
//   bg-preload effects in App.tsx short-circuit while paused, so no new
//   priority-2 jobs flow through the queues. v3.137 keeps startup latest-track
//   warmup independent of this pause so switching can still become instantly
//   ready after launch. In-flight jobs keep going until they finish naturally
//   (no abort signal — letting them finish matches the queue's existing
//   cancellation policy and avoids partial-write artifacts in the mastering
//   cache).
//
// v3.121 (Concern 1) — hover/focus popover that explains the
//   "active / queued" pill at a glance. Ethan kept asking what the two
//   numbers mean; the answer (active = currently processing,
//   queued = waiting, priority bypass for clicks, pause stops new jobs,
//   60s task timeout) belongs right next to the pill rather than buried
//   in a help-tooltip elsewhere. Opens on mouseenter and on keyboard focus
//   (focus visibility shows it; Esc dismisses it). Click does NOT toggle
//   the popover — Ethan asked specifically for hover semantics, not a
//   click modal.
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { dumpPreviewAnalysisQueue } from './audioAnalysis';

export interface BackgroundTasksIndicatorProps {
  /**
   * Function returning the measured queue dump. Passed in (rather than
   * imported) because the measured queue lives in App.tsx — keeps
   * audioAnalysisQueue.ts decoupled from renderer state.
   */
  getMeasuredDump: () => {
    active: number;
    userBypassActive: number;
    pending: number;
    pendingByPriority: { user: number; neighbor: number; background: number };
  };
  /**
   * v3.120 — current pause state. When true, the indicator renders in the
   * muted "paused" treatment regardless of queue activity. Bound to user
   * state's `agentBackgroundPrecomputeEnabled` (inverted) in App.tsx.
   */
  paused?: boolean;
  /**
   * v3.120 — fired when the user clicks the pause/play button. App.tsx
   * uses this to flip `agentBackgroundPrecomputeEnabled`. Optional so the
   * indicator can still mount in legacy callsites without the toggle.
   */
  onTogglePaused?: () => void;
}

interface AggregateSnapshot {
  active: number;
  pending: number;
  bgPending: number;
}

function aggregate(
  preview: ReturnType<typeof dumpPreviewAnalysisQueue>,
  measured: BackgroundTasksIndicatorProps['getMeasuredDump'] extends () => infer R ? R : never
): AggregateSnapshot {
  const active =
    preview.active + preview.userBypassActive + measured.active + measured.userBypassActive;
  const pending = preview.pending + measured.pending;
  const bgPending =
    preview.pendingByPriority.background + measured.pendingByPriority.background;
  return { active, pending, bgPending };
}

const POLL_INTERVAL_MS = 500;
const POPOVER_MAX_WIDTH_PX = 520;
const POPOVER_VIEWPORT_MARGIN_PX = 12;

export function BackgroundTasksIndicator(
  props: BackgroundTasksIndicatorProps
): JSX.Element | null {
  const { getMeasuredDump, paused = false, onTogglePaused } = props;
  const [snapshot, setSnapshot] = useState<AggregateSnapshot>(() =>
    aggregate(dumpPreviewAnalysisQueue(), getMeasuredDump())
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
      const next = aggregate(dumpPreviewAnalysisQueue(), getMeasuredDump());
      // Cheap shallow compare to avoid spurious re-renders.
      setSnapshot((previous) => {
        if (
          previous.active === next.active &&
          previous.pending === next.pending &&
          previous.bgPending === next.bgPending
        ) {
          return previous;
        }
        return next;
      });
    };

    tick();
    const handle = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [getMeasuredDump]);

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
    // Don't close when the cursor moves between sibling children (button,
    // dot, label, popover itself). Only close when leaving the pill.
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

  // v3.120 — pre-3.120 we returned null when both queues were idle. Now
  // we keep the pill mounted whenever the user has paused precompute so
  // the resume button is always reachable. The pill is still hidden in
  // the steady state (idle + not paused) to avoid visual noise.
  const idle = snapshot.active === 0 && snapshot.pending === 0;
  if (idle && !paused) {
    return null;
  }

  // v3.121 (Concern 1) — short native title kept as a fallback for
  // screenreaders / touch users who can't hover. The full explanation
  // lives in the popover below.
  const tooltip = paused
    ? 'Background measured analysis paused. Hover for details.'
    : `Audio analysis: ${snapshot.active} processing` +
      (snapshot.pending > 0 ? `, ${snapshot.pending} queued` : '') +
      '. Hover for details.';

  const buttonLabel = paused
    ? 'Resume background analysis'
    : 'Pause background analysis';
  const popoverStyle: CSSProperties | undefined = popoverPosition
    ? {
        left: popoverPosition.left,
        top: popoverPosition.top,
      }
    : undefined;

  return (
    <span
      ref={containerRef}
      className={
        paused ? 'bg-tasks-indicator bg-tasks-indicator-paused' : 'bg-tasks-indicator'
      }
      role="status"
      aria-live="polite"
      title={tooltip}
      data-testid="bg-tasks-indicator"
      data-paused={paused ? 'true' : 'false'}
      data-popover-open={popoverOpen ? 'true' : 'false'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <span
        className={
          paused
            ? 'bg-tasks-indicator-dot bg-tasks-indicator-dot-paused'
            : 'bg-tasks-indicator-dot'
        }
        aria-hidden="true"
      />
      <span className="bg-tasks-indicator-label">
        {paused
          ? 'paused'
          : `${snapshot.active > 0 ? snapshot.active : '·'}${
              snapshot.pending > 0 ? ` / ${snapshot.pending}` : ''
            }`}
      </span>
      {onTogglePaused ? (
        <button
          type="button"
          className="bg-tasks-indicator-toggle"
          onClick={(event) => {
            // Stop the click from bubbling to anything that wraps the pill
            // (e.g. focus stealers in the sidebar header).
            event.stopPropagation();
            onTogglePaused();
          }}
          aria-label={buttonLabel}
          title={buttonLabel}
          data-testid="bg-tasks-indicator-toggle"
        >
          {paused ? (
            // Play triangle (▶) — resume
            <svg
              viewBox="0 0 12 12"
              width="9"
              height="9"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3 1.5 L10 6 L3 10.5 Z" fill="currentColor" />
            </svg>
          ) : (
            // Pause bars (⏸) — stop new bg jobs
            <svg
              viewBox="0 0 12 12"
              width="9"
              height="9"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="2.5" y="1.5" width="2.5" height="9" fill="currentColor" />
              <rect x="7" y="1.5" width="2.5" height="9" fill="currentColor" />
            </svg>
          )}
        </button>
      ) : null}
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
            {paused
              ? 'paused — optional background jobs are stopped; startup measured warmup may finish.'
              : `${snapshot.active} job${snapshot.active === 1 ? '' : 's'} running, ${snapshot.pending} waiting in line.`}
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
            jobs waiting for an open slot. Clicking a track jumps the queue
            (user-priority bypasses up to 3 background jobs so a click
            never stalls behind precompute).
          </span>
          <span className="bg-tasks-indicator-popover-row">
            <strong className="bg-tasks-indicator-popover-row-label">
              Pause:
            </strong>{' '}
            stops optional background-precompute jobs. Startup latest-track
            measured warmup can still finish so LUFS/stat switching is ready;
            in-flight jobs finish naturally — no partial-write artifacts in the
            cache.
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
