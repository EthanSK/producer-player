import { toast as sonnerToast } from 'sonner';
import { openLogSliceViewer } from './logSliceViewerBus';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastLogRef {
  file: string;
  startLine: number;
  endLine: number;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
  durationMs?: number;
  logRef?: ToastLogRef;
}

interface ToastApi {
  show: (toast: Toast) => void;
  dismiss: (id: string) => void;
}

// v3.63 — ALL toasts auto-dismiss. Previously `error` was sticky (Infinity)
// unless the user clicked. Ethan's call: even "AI thing started" error toasts
// should fade on their own. 8s gives enough time to read + click "View log".
const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  warning: 6000,
  error: 8000,
};

function durationFor(toast: Toast): number {
  // v3.63 — only honor explicit durations that are positive finite ms.
  // Zero / negative / undefined all fall back to the kind default so toasts
  // never stick around indefinitely.
  if (typeof toast.durationMs === 'number' && toast.durationMs > 0) {
    return toast.durationMs;
  }
  return DEFAULT_DURATION_MS[toast.kind] ?? 4000;
}

export function useToast(): ToastApi {
  return {
    show(toast) {
      const options = {
        id: toast.id,
        duration: durationFor(toast),
        action:
          toast.kind === 'error' && toast.logRef
            ? {
                label: 'View log',
                onClick: () => openLogSliceViewer(toast.logRef!),
              }
            : undefined,
      };

      if (toast.kind === 'success') {
        sonnerToast.success(toast.text, options);
      } else if (toast.kind === 'warning') {
        sonnerToast.warning(toast.text, options);
      } else if (toast.kind === 'error') {
        sonnerToast.error(toast.text, options);
      } else {
        sonnerToast.info(toast.text, options);
      }
    },
    dismiss(id) {
      sonnerToast.dismiss(id);
    },
  };
}
