import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from './Tooltip';

export type BackgroundMode = 'black' | 'white' | 'system' | 'translucent';

const STORAGE_KEY = 'canvas-background-mode';

export function loadBackgroundMode(): BackgroundMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'black' || raw === 'white' || raw === 'system' || raw === 'translucent') {
      return raw;
    }
  } catch {
    // ignore
  }
  return 'black';
}

export function saveBackgroundMode(mode: BackgroundMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

const MODES: { id: BackgroundMode; label: string; icon: React.ReactNode; tooltip: string }[] = [
  {
    id: 'black',
    label: 'Black',
    tooltip: 'Solid black background',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: 3,
          background: '#0f0f0f',
          border: '1px solid #3a3a3a',
        }}
      />
    ),
  },
  {
    id: 'white',
    label: 'White',
    tooltip: 'Solid white background',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: 3,
          background: '#ffffff',
          border: '1px solid #ccc',
        }}
      />
    ),
  },
  {
    id: 'system',
    label: 'System',
    tooltip: 'Match the system appearance (auto dark/light)',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: 3,
          background: 'linear-gradient(135deg, #0f0f0f 50%, #ffffff 50%)',
          border: '1px solid #3a3a3a',
        }}
      />
    ),
  },
  {
    id: 'translucent',
    label: 'Translucent',
    tooltip: 'See-through window (desktop blurs behind)',
    icon: (
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: 3,
          background:
            'linear-gradient(135deg, rgba(120,160,200,0.4), rgba(200,160,120,0.4))',
          border: '1px solid #3a3a3a',
        }}
      />
    ),
  },
];

interface Props {
  mode: BackgroundMode;
  onChange: (mode: BackgroundMode) => void;
}

export const BackgroundPicker: React.FC<Props> = ({ mode, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [open]);

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div
      ref={ref}
      style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}
    >
      <Tooltip label={`Background: ${current.label}`} side="bottom">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label="Background"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            background: '#2a2a2a',
            color: '#d0d0d0',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {current.icon}
          <span>BG</span>
        </button>
      </Tooltip>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 180,
            background: '#1a1a1a',
            border: '1px solid #3a3a3a',
            borderRadius: 6,
            padding: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 2000,
          }}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                background: m.id === mode ? '#2a2a2a' : 'transparent',
                color: '#d0d0d0',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (m.id !== mode) e.currentTarget.style.background = '#252525';
              }}
              onMouseLeave={(e) => {
                if (m.id !== mode) e.currentTarget.style.background = 'transparent';
              }}
            >
              {m.icon}
              <span style={{ flex: 1 }}>{m.label}</span>
              {m.id === mode && <span style={{ color: '#5a9fd4' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
