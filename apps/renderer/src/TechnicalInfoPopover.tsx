import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

interface TechnicalInfoPopoverProps {
  text: string;
}

/* ─── Modal overlay & content ─── */

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  padding: 24,
};

const modalStyle: CSSProperties = {
  background: '#0d1520',
  border: '1px solid #2b3a49',
  borderRadius: 10,
  padding: '16px 20px',
  maxWidth: 440,
  width: '100%',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  color: '#c6d5e8',
  fontSize: 12,
  lineHeight: 1.6,
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.5)',
  position: 'relative',
};

const titleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#7a8fa3',
  marginBottom: 8,
  paddingRight: 28,
};

const closeButtonStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: '1px solid rgba(156, 175, 196, 0.2)',
  background: 'transparent',
  color: '#7a8fa3',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
};

const bodyStyle: CSSProperties = {
  color: '#9cafc4',
  whiteSpace: 'pre-wrap',
};

/* ─── Modal component (portalled) ─── */

function InfoModal({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}): JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape — use capture phase and stop propagation so parent
  // Escape handlers (e.g. fullscreen mastering overlay) don't also fire.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // Move focus into the dialog on mount and restore on unmount
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label="Technical Details">
        <button
          ref={closeButtonRef}
          type="button"
          style={closeButtonStyle}
          onClick={onClose}
          aria-label="Close"
          title="Close"
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#ecf2f9';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#7a8fa3';
          }}
        >
          &times;
        </button>
        <div style={titleStyle}>Technical Details</div>
        <div style={bodyStyle}>{text}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Exported component ─── */

export function TechnicalInfoPopover({ text }: TechnicalInfoPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="technical-info-trigger"
        aria-label="Technical details"
        title="Technical details"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
          className="technical-info-trigger-icon"
        >
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <text
            x="6"
            y="8.8"
            textAnchor="middle"
            fill="currentColor"
            fontSize="7.5"
            fontFamily="-apple-system, BlinkMacSystemFont, serif"
            fontStyle="italic"
            fontWeight="600"
          >
            i
          </text>
        </svg>
      </button>
      {open && <InfoModal text={text} onClose={handleClose} />}
    </>
  );
}
