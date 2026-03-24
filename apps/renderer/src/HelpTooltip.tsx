import { useState, useRef, useEffect, type CSSProperties } from 'react';

export interface HelpTooltipLink {
  label: string;
  url: string;
}

interface HelpTooltipProps {
  text: string;
  links?: HelpTooltipLink[];
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '1px solid rgba(156, 175, 196, 0.35)',
  color: '#9cafc4',
  fontSize: 9,
  fontWeight: 700,
  cursor: 'help',
  lineHeight: 1,
  verticalAlign: 'middle',
  marginLeft: 4,
  flexShrink: 0,
  userSelect: 'none' as const,
};

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#1a2332',
  border: '1px solid rgba(156, 175, 196, 0.2)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  lineHeight: 1.45,
  color: '#c6d5e8',
  maxWidth: 320,
  width: 'max-content',
  zIndex: 100,
  pointerEvents: 'auto' as const,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
};

const linkSectionStyle: CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: '1px solid rgba(156, 175, 196, 0.15)',
  fontSize: 11,
  lineHeight: 1.5,
};

const linkLabelStyle: CSSProperties = {
  color: '#7a8fa3',
  fontWeight: 600,
  marginBottom: 2,
};

const linkStyle: CSSProperties = {
  color: '#6ea8fe',
  textDecoration: 'none',
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export function HelpTooltip({ text, links }: HelpTooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleLinkClick = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

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
  };

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setVisible(true);
      }}
      onMouseLeave={() => {
        timeoutRef.current = setTimeout(() => setVisible(false), 200);
      }}
    >
      <span style={triggerStyle} aria-label="Help" role="img">?</span>
      {visible ? (
        <span style={tooltipStyle}>
          {text}
          {links && links.length > 0 && (
            <span style={linkSectionStyle}>
              <span style={linkLabelStyle}>Learn more:</span>
              {links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  style={linkStyle}
                  onClick={handleLinkClick(link.url)}
                  onMouseOver={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
                  onMouseOut={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.label}
                >
                  {link.label}
                </a>
              ))}
            </span>
          )}
        </span>
      ) : null}
    </span>
  );
}
