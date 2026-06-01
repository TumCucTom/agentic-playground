import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: React.ReactElement;
  side?: 'right' | 'left' | 'top' | 'bottom';
}

export const Tooltip: React.FC<TooltipProps> = ({ label, shortcut, children, side = 'right' }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  const showTooltip = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        let x = 0;
        let y = 0;
        if (side === 'right') {
          x = rect.right + 8;
          y = rect.top + rect.height / 2;
        } else if (side === 'left') {
          x = rect.left - 8;
          y = rect.top + rect.height / 2;
        } else if (side === 'top') {
          x = rect.left + rect.width / 2;
          y = rect.top - 8;
        } else {
          x = rect.left + rect.width / 2;
          y = rect.bottom + 8;
        }
        setPos({ x, y });
      }
      setShow(true);
    }, 250);
  };

  const hideTooltip = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShow(false);
  };

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const transform =
    side === 'right' || side === 'left'
      ? 'translateY(-50%)'
      : 'translateX(-50%)';

  return (
    <span
      ref={wrapperRef}
      style={{ display: 'inline-flex' }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {show && pos && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform,
            background: '#2a2a2a',
            color: '#d0d0d0',
            padding: '5px 9px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            border: '1px solid #3a3a3a',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{label}</span>
          {shortcut && (
            <span
              style={{
                fontSize: 10,
                color: '#888',
                fontFamily: 'monospace',
                background: '#1a1a1a',
                padding: '1px 4px',
                borderRadius: 2,
              }}
            >
              {shortcut}
            </span>
          )}
        </div>
      )}
    </span>
  );
};
