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

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  warning: 6000,
  error: Infinity,
};

function durationFor(toast: Toast): number {
  return toast.durationMs === 0
    ? Infinity
    : toast.durationMs ?? DEFAULT_DURATION_MS[toast.kind] ?? 4000;
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
