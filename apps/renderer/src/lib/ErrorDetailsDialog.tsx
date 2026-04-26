/*
 * ErrorDetailsDialog
 *
 * Generic, scrollable modal that surfaces long error payloads (raw stack
 * traces, electron-updater Authenticode dumps, etc.) without the side-pane
 * horizontal-overflow truncation that hid the original failure mode.
 *
 * Used by the Support / Updates strip when an auto-update failure or other
 * IPC error needs to be readable in full. The status pane still keeps a
 * short one-liner (`{title}` or "Update failed — click for details") and
 * mounts this dialog on click.
 */

import { useEffect, useRef, type JSX } from 'react';

export interface ErrorDetailsDialogProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

export function ErrorDetailsDialog(props: ErrorDetailsDialogProps): JSX.Element | null {
  const { open, title, message, onClose } = props;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = (): void => {
    void navigator.clipboard?.writeText(message).catch(() => {
      /* clipboard unavailable — silent */
    });
  };

  return (
    <div
      className="error-details-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="error-details-dialog-backdrop"
    >
      <div
        className="error-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="error-details-dialog"
      >
        <header className="error-details-dialog__header">
          <h2 className="error-details-dialog__title">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="error-details-dialog__close"
            onClick={onClose}
            aria-label="Close error details"
            data-testid="error-details-dialog-close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <pre className="error-details-dialog__body" data-testid="error-details-dialog-body">
          {message}
        </pre>

        <footer className="error-details-dialog__footer">
          <button
            type="button"
            className="ghost"
            onClick={handleCopy}
            data-testid="error-details-dialog-copy"
          >
            Copy
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            data-testid="error-details-dialog-close-button"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
