/**
 * ToastStack (v3.45) — lightweight snackbar/toast system.
 * ---------------------------------------------------------------------------
 * A small fixed-position stack at the bottom-left that surfaces status
 * updates like "AI recommendations started" or "Plugin scan finished".
 *
 * Design goals:
 * - Zero external dependencies — React + existing CSS token palette only.
 * - Auto-dismiss with a per-toast timer (default 4s for info/success,
 *   6s for warning, no auto-dismiss for error until user clicks).
 * - Keyed by `id` so the caller can update or replace an existing toast
 *   (used for "start → finish" transitions on the same event without
 *   stacking two unrelated toasts).
 * - Imperative API exposed via a React context so any component tree can
 *   call `useToast().show({ kind, text })`.
 *
 * Usage:
 *   <ToastProvider> ...app... </ToastProvider>
 *
 *   const toast = useToast();
 *   toast.show({ id: 'scan', kind: 'info', text: 'Plugin scan started…' });
 *   toast.show({ id: 'scan', kind: 'success', text: 'Plugin scan finished' });
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
  /** Override default dismiss timeout in ms; 0 = sticky. */
  durationMs?: number;
}

interface ToastApi {
  show: (toast: Toast) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 0, // sticky until dismissed
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const show = useCallback(
    (toast: Toast) => {
      clearTimer(toast.id);
      setToasts((prev) => {
        const existingIndex = prev.findIndex((t) => t.id === toast.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = toast;
          return next;
        }
        return [...prev, toast];
      });
      const duration =
        toast.durationMs ?? DEFAULT_DURATION_MS[toast.kind] ?? 4000;
      if (duration > 0) {
        const handle = setTimeout(() => {
          dismiss(toast.id);
        }, duration);
        timersRef.current.set(toast.id, handle);
      }
    },
    [clearTimer, dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="toast-stack"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        data-testid="toast-stack"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast--${toast.kind}`}
            data-testid={`toast-${toast.id}`}
            onClick={() => dismiss(toast.id)}
            title="Dismiss"
          >
            <span className="toast__text">{toast.text}</span>
            <span className="toast__dismiss" aria-hidden="true">
              &#x2715;
            </span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Resolve the toast API. Returns a no-op shim if the provider isn't
 * mounted so rendering never crashes in tests / standalone component
 * previews. Real calls go through the provider above.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}
