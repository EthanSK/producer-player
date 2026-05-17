/**
 * v3.46 — Per-row importance meter + help popover for the Mastering
 * Checklist.
 *
 * Two tiny presentational components sharing this file because they're
 * only used together, in a single call site (the fullscreen Mastering
 * Checklist panel in App.tsx).
 *
 * - `<MasteringChecklistImportanceMeter />` — a read-only 1-5 dot
 *   indicator. Colour-neutral: row colour is reserved for pass/warn/fail
 *   health, while the dot count communicates importance.
 *
 * - `<MasteringChecklistRowHelp />` — a (?) button that reveals a small
 *   popover showing the authored `whyItMatters` blurb plus the
 *   importance band. Uses a native `<details>` / controlled `useState`
 *   hybrid so the popover can be dismissed by clicking outside, and so
 *   tests can open it by clicking the summary button.
 *
 * Both components are intentionally styled via existing CSS tokens
 * (`var(--success)`, `var(--accent)`, `var(--border)`, …) so they drop
 * into the mastering panel without fighting the checklist's existing
 * visual language.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MasteringChecklistImportance } from '../masteringChecklistRules';

// ---------------------------------------------------------------------------
// Importance meter
// ---------------------------------------------------------------------------

const BAND_LABEL: Record<MasteringChecklistImportance, string> = {
  1: 'Low importance — nice-to-have polish',
  2: 'Low importance — minor improvement',
  3: 'Medium importance — worth fixing on final masters',
  4: 'High importance — most pros would reject a master that fails this',
  5: 'Critical — deal-breaker for streaming or QC approval',
};

function bandForImportance(importance: MasteringChecklistImportance): 'low' | 'mid' | 'high' {
  if (importance >= 4) return 'high';
  if (importance >= 3) return 'mid';
  return 'low';
}

export interface MasteringChecklistImportanceMeterProps {
  importance: MasteringChecklistImportance;
  ruleLabel: string;
}

export function MasteringChecklistImportanceMeter({
  importance,
  ruleLabel,
}: MasteringChecklistImportanceMeterProps): JSX.Element {
  const band = bandForImportance(importance);
  return (
    <span
      className={`mastering-checklist-importance-meter importance-${band}`}
      data-testid={`mastering-checklist-importance-${ruleLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}`}
      aria-label={`Importance ${importance} of 5 — ${BAND_LABEL[importance]}`}
      title={`Importance ${importance} / 5 — ${BAND_LABEL[importance]}`}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((slot) => (
        <span
          key={slot}
          aria-hidden="true"
          className={`mastering-checklist-importance-dot${
            slot <= importance ? ' is-filled' : ''
          }`}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-row help popover
// ---------------------------------------------------------------------------

export interface MasteringChecklistRowHelpProps {
  ruleLabel: string;
  importance: MasteringChecklistImportance;
  whyItMatters: string;
}

export function MasteringChecklistRowHelp({
  ruleLabel,
  importance,
  whyItMatters,
}: MasteringChecklistRowHelpProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close on outside click / Escape. Re-uses the same pattern as
  // `HelpTooltip` in the same codebase so behaviour stays consistent.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <span
      ref={wrapRef}
      className={`mastering-checklist-row-help${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="mastering-checklist-row-help-trigger"
        aria-label={`Why ${ruleLabel} matters`}
        aria-expanded={open}
        data-testid={`mastering-checklist-row-help-${ruleLabel
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')}`}
        title="Why this matters"
        onClick={toggle}
      >
        ?
      </button>
      {open ? (
        <span
          className="mastering-checklist-row-help-popover"
          role="dialog"
          aria-label={`Why ${ruleLabel} matters`}
        >
          <span className="mastering-checklist-row-help-title">{ruleLabel}</span>
          <span className="mastering-checklist-row-help-importance">
            Importance {importance} / 5 — {BAND_LABEL[importance]}
          </span>
          <span className="mastering-checklist-row-help-body">{whyItMatters}</span>
        </span>
      ) : null}
    </span>
  );
}
