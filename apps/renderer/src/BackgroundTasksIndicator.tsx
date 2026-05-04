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
  const { getMeasuredDump } = props;
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

  if (snapshot.active === 0 && snapshot.pending === 0) {
    return null;
  }

  const tooltip =
    `Background analysis: ${snapshot.active} processing` +
    (snapshot.pending > 0 ? `, ${snapshot.pending} queued` : '');

  return (
    <span
      className="bg-tasks-indicator"
      role="status"
      aria-live="polite"
      title={tooltip}
      data-testid="bg-tasks-indicator"
    >
      <span className="bg-tasks-indicator-dot" aria-hidden="true" />
      <span className="bg-tasks-indicator-label">
        {snapshot.active > 0 ? snapshot.active : '·'}
        {snapshot.pending > 0 ? ` / ${snapshot.pending}` : ''}
      </span>
    </span>
  );
}
