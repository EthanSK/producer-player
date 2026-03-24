import { useState, useRef, useEffect, type CSSProperties } from 'react';

interface HelpTooltipProps {
  text: string;
}

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: '1px solid rgba(156, 175, 196, 0.35)',
  color: '#9cafc4',
  fontSize: 10,
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
  maxWidth: 280,
  width: 'max-content',
  zIndex: 100,
  pointerEvents: 'none' as const,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
};

export function HelpTooltip({ text }: HelpTooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setVisible(true);
      }}
      onMouseLeave={() => {
        timeoutRef.current = setTimeout(() => setVisible(false), 120);
      }}
    >
      <span style={triggerStyle} aria-label="Help" role="img">?</span>
      {visible ? <span style={tooltipStyle}>{text}</span> : null}
    </span>
  );
}
