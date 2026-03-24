import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface HelpTooltipLink {
  label: string;
  url: string;
}

interface HelpTooltipProps {
  text: string;
  links?: HelpTooltipLink[];
}

/** Extract YouTube video ID from a URL, or return null. */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {
    /* ignore */
  }
  return null;
}

function openExternalUrl(url: string): void {
  const producerPlayerBridge =
    typeof window !== 'undefined'
      ? (window as unknown as {
          producerPlayer?: { openExternalUrl?: (externalUrl: string) => Promise<void> };
        }).producerPlayer
      : undefined;

  if (producerPlayerBridge && typeof producerPlayerBridge.openExternalUrl === 'function') {
    void producerPlayerBridge.openExternalUrl(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ─── Trigger button (the ? icon) ─── */

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '1px solid rgba(156, 175, 196, 0.35)',
  background: 'transparent',
  color: '#9cafc4',
  fontSize: 9,
  fontWeight: 700,
  cursor: 'pointer',
  lineHeight: 1,
  verticalAlign: 'middle',
  marginLeft: 4,
  flexShrink: 0,
  userSelect: 'none' as const,
  padding: 0,
};

/* ─── Modal overlay & content ─── */

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  padding: 24,
};

const modalStyle: CSSProperties = {
  background: '#111922',
  border: '1px solid #2b3a49',
  borderRadius: 12,
  padding: '20px 24px',
  maxWidth: 520,
  width: '100%',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  color: '#ecf2f9',
  fontSize: 13,
  lineHeight: 1.55,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  position: 'relative',
};

const closeButtonStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 26,
  height: 26,
  borderRadius: '50%',
  border: '1px solid rgba(156, 175, 196, 0.25)',
  background: 'transparent',
  color: '#9cafc4',
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
};

const helpTextStyle: CSSProperties = {
  color: '#c6d5e8',
  whiteSpace: 'pre-wrap',
  marginBottom: 12,
  paddingRight: 28, // keep clear of close button
};

const linkSectionStyle: CSSProperties = {
  marginTop: 8,
  paddingTop: 10,
  borderTop: '1px solid rgba(156, 175, 196, 0.15)',
  fontSize: 12,
  lineHeight: 1.6,
};

const linkLabelStyle: CSSProperties = {
  color: '#7a8fa3',
  fontWeight: 600,
  marginBottom: 4,
  display: 'block',
};

const linkStyle: CSSProperties = {
  color: '#6ea8fe',
  textDecoration: 'none',
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  padding: '1px 0',
};

const videoSectionStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: '1px solid rgba(156, 175, 196, 0.15)',
};

const videoGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 10,
  marginTop: 8,
};

const videoCardStyle: CSSProperties = {
  cursor: 'pointer',
  borderRadius: 6,
  overflow: 'hidden',
  border: '1px solid rgba(156, 175, 196, 0.15)',
  background: '#0d1520',
  transition: 'border-color 0.15s',
};

const thumbnailStyle: CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  display: 'block',
};

const videoCaptionStyle: CSSProperties = {
  fontSize: 10,
  lineHeight: 1.35,
  padding: '5px 6px',
  color: '#9cafc4',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/* ─── Modal component (portalled) ─── */

function HelpModal({
  text,
  links,
  onClose,
}: {
  text: string;
  links: HelpTooltipLink[];
  onClose: () => void;
}): JSX.Element {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Separate YouTube links (for thumbnails) from non-YouTube links
  const youtubeLinks: (HelpTooltipLink & { videoId: string })[] = [];
  const otherLinks: HelpTooltipLink[] = [];
  for (const link of links) {
    const id = extractYouTubeId(link.url);
    if (id) {
      youtubeLinks.push({ ...link, videoId: id });
    } else {
      otherLinks.push(link);
    }
  }

  // Show up to 3 YouTube thumbnails
  const videoThumbs = youtubeLinks.slice(0, 3);

  return createPortal(
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true">
        <button
          type="button"
          style={closeButtonStyle}
          onClick={onClose}
          aria-label="Close"
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#ecf2f9';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#9cafc4';
          }}
        >
          &times;
        </button>

        <div style={helpTextStyle}>{text}</div>

        {otherLinks.length > 0 && (
          <div style={linkSectionStyle}>
            <span style={linkLabelStyle}>Learn more:</span>
            {otherLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                style={linkStyle}
                onClick={(e) => {
                  e.preventDefault();
                  openExternalUrl(link.url);
                }}
                onMouseOver={(e) => {
                  (e.target as HTMLElement).style.textDecoration = 'underline';
                }}
                onMouseOut={(e) => {
                  (e.target as HTMLElement).style.textDecoration = 'none';
                }}
                target="_blank"
                rel="noopener noreferrer"
                title={link.label}
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {videoThumbs.length > 0 && (
          <div style={videoSectionStyle}>
            <span style={linkLabelStyle}>Video tutorials:</span>
            <div style={videoGridStyle}>
              {videoThumbs.map((v) => (
                <div
                  key={v.videoId}
                  style={videoCardStyle}
                  onClick={() => openExternalUrl(v.url)}
                  title={v.label}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#5ca7ff';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(156, 175, 196, 0.15)';
                  }}
                >
                  <img
                    src={`https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`}
                    alt={v.label}
                    style={thumbnailStyle}
                    loading="lazy"
                  />
                  <div style={videoCaptionStyle}>{v.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Exported component ─── */

export function HelpTooltip({ text, links }: HelpTooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        style={triggerStyle}
        aria-label="Help"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        ?
      </button>
      {open && <HelpModal text={text} links={links ?? []} onClose={handleClose} />}
    </>
  );
}
