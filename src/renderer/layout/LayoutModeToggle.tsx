import React from 'react';
import { useCanvasStore } from '../state/canvasStore';
import { Tooltip } from '../Tooltip';

export const LayoutModeToggle: React.FC = () => {
  const layoutMode = useCanvasStore((s) => s.layoutMode);
  const setLayoutMode = useCanvasStore((s) => s.setLayoutMode);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    background: active ? '#3a3a3a' : 'transparent',
    color: active ? '#fff' : '#888',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: active ? 500 : 400,
  });

  return (
    <Tooltip label="Toggle layout mode  ⌘⇧L" side="bottom">
      <div
        style={{
          display: 'inline-flex',
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: 2,
          gap: 2,
        }}
      >
        <button
          onClick={() => setLayoutMode('canvas')}
          style={pillStyle(layoutMode === 'canvas')}
          aria-label="Canvas mode"
          aria-pressed={layoutMode === 'canvas'}
        >
          Canvas
        </button>
        <button
          onClick={() => setLayoutMode('grid')}
          style={pillStyle(layoutMode === 'grid')}
          aria-label="Grid mode"
          aria-pressed={layoutMode === 'grid'}
        >
          Grid
        </button>
      </div>
    </Tooltip>
  );
};
