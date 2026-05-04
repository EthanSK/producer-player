// Item #14 (v3.118) — Background tasks indicator.
//
// Compact Rekordbox-style pill that lives in the status sidebar header,
// next to "Status". Renders a spinner + count of in-flight + queued audio
// analysis jobs (preview decode + measured ffmpeg). Hidden when both
// queues are idle so it doesn't add noise during normal use.
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
//   renders in a muted "paused" treatment with a "paused" label. The
//   bg-preload effects in App.tsx short-circuit while paused, so no new
//   priority-2 jobs flow through the queues. In-flight bg jobs keep going
//   until they finish naturally (no abort signal — letting them finish
//   matches the queue's existing cancellation policy and avoids partial-
//   write artifacts in the mastering cache).
import { useEffect, useState } from 'react';
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

export function BackgroundTasksIndicator(
  props: BackgroundTasksIndicatorProps
): JSX.Element | null {
  const { getMeasuredDump, paused = false, onTogglePaused } = props;
  const [snapshot, setSnapshot] = useState<AggregateSnapshot>(() =>
    aggregate(dumpPreviewAnalysisQueue(), getMeasuredDump())
  );

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

  // v3.120 — pre-3.120 we returned null when both queues were idle. Now
  // we keep the pill mounted whenever the user has paused precompute so
  // the resume button is always reachable. The pill is still hidden in
  // the steady state (idle + not paused) to avoid visual noise.
  const idle = snapshot.active === 0 && snapshot.pending === 0;
  if (idle && !paused) {
    return null;
  }

  const tooltip = paused
    ? 'Background analysis paused. Click ▶ to resume.'
    : `Background analysis: ${snapshot.active} processing` +
      (snapshot.pending > 0 ? `, ${snapshot.pending} queued` : '');

  const buttonLabel = paused
    ? 'Resume background analysis'
    : 'Pause background analysis';

  return (
    <span
      className={
        paused ? 'bg-tasks-indicator bg-tasks-indicator-paused' : 'bg-tasks-indicator'
      }
      role="status"
      aria-live="polite"
      title={tooltip}
      data-testid="bg-tasks-indicator"
      data-paused={paused ? 'true' : 'false'}
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
    </span>
  );
}
