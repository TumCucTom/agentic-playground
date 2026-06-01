import React from 'react';
import { PanelType } from '../shared/types';
import { useCanvasStore } from './state/canvasStore';
import { createPanelOfType } from './panels/factory';
import { viewportToCanvas } from './utils/coordinates';

const ITEMS: { type: PanelType; label: string; icon: string }[] = [
  { type: 'terminal', label: 'Terminal', icon: '⌨' },
  { type: 'editor', label: 'Editor', icon: '✎' },
  { type: 'fileExplorer', label: 'Files', icon: '📁' },
  { type: 'webview', label: 'Web', icon: '🌐' },
  { type: 'markdownPreview', label: 'MD', icon: '¶' },
];

export const Toolbox: React.FC = () => {
  const addPanel = useCanvasStore((s) => s.addPanel);
  const viewport = useCanvasStore((s) => s.viewport);

  const handleAdd = (type: PanelType) => {
    // Place at viewport center
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const canvasPt = viewportToCanvas(centerX, centerY, viewport);
    const panel = createPanelOfType(type, canvasPt.x, canvasPt.y);
    addPanel(panel);
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 28,
        bottom: 0,
        width: 56,
        backgroundColor: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 6,
        zIndex: 1000,
        WebkitAppRegion: 'drag',
      }}
    >
      {ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => handleAdd(item.type)}
          title={item.label}
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            backgroundColor: 'transparent',
            border: '1px solid transparent',
            color: '#d0d0d0',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2a2a2a';
            e.currentTarget.style.borderColor = '#3a3a3a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
};
