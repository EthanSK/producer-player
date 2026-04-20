export interface LogSliceRef {
  file: string;
  startLine: number;
  endLine: number;
}

type LogSliceViewerListener = (ref: LogSliceRef) => void;

const listeners = new Set<LogSliceViewerListener>();

export function openLogSliceViewer(ref: LogSliceRef): void {
  for (const listener of listeners) {
    listener(ref);
  }
}

export function subscribeLogSliceViewer(
  listener: LogSliceViewerListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
