import { useEffect, useRef, useState } from 'react';
import {
  subscribeLogSliceViewer,
  type LogSliceRef,
} from './logSliceViewerBus';

interface LogSliceResult {
  file: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

type ViewerState =
  | { status: 'closed' }
  | { status: 'loading'; ref: LogSliceRef }
  | { status: 'loaded'; result: LogSliceResult }
  | { status: 'failed'; ref: LogSliceRef; error: string };

export function LogSliceViewer(): JSX.Element | null {
  const [state, setState] = useState<ViewerState>({ status: 'closed' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    return subscribeLogSliceViewer((ref) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState({ status: 'loading', ref });
      void window.producerPlayer
        .logReadSlice(ref)
        .then((result) => {
          if (requestIdRef.current === requestId) {
            setState({ status: 'loaded', result });
          }
        })
        .catch((err) => {
          if (requestIdRef.current === requestId) {
            setState({ status: 'failed', ref, error: String(err) });
          }
        });
    });
  }, []);

  useEffect(() => {
    if (state.status === 'closed') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setState({ status: 'closed' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.status]);

  if (state.status === 'closed') {
    return null;
  }

  const title =
    state.status === 'loaded'
      ? `${state.result.file}:${state.result.startLine}-${state.result.endLine}`
      : state.ref.file;
  const body =
    state.status === 'loading'
      ? 'Loading log slice...'
      : state.status === 'failed'
      ? `Could not load log slice.\n\n${state.error}`
      : state.result.lines
          .map((line, index) => {
            const lineNumber = state.result.startLine + index;
            return `${String(lineNumber).padStart(5, ' ')}  ${line}`;
          })
          .join('\n');

  return (
    <div
      className="log-slice-backdrop"
      role="presentation"
      onClick={() => setState({ status: 'closed' })}
    >
      <section
        className="log-slice-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Log slice"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="log-slice-header">
          <div className="log-slice-title" title={title}>
            {title}
          </div>
          <button
            type="button"
            className="log-slice-close"
            onClick={() => setState({ status: 'closed' })}
            aria-label="Close log viewer"
          >
            Close
          </button>
        </header>
        <pre className="log-slice-pre">{body}</pre>
      </section>
    </div>
  );
}
