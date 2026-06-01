import React from 'react';
import { PanelType } from '../shared/types';

interface Props {
  x: number;
  y: number;
  onAdd: (type: PanelType) => void;
  onClose: () => void;
}

const MENU_ITEMS: { type: PanelType; label: string; icon: string }[] = [
  { type: 'terminal', label: 'Terminal', icon: '⌨' },
  { type: 'editor', label: 'Editor', icon: '✎' },
  { type: 'fileExplorer', label: 'File Explorer', icon: '📁' },
  { type: 'webview', label: 'Webview', icon: '🌐' },
  { type: 'markdownPreview', label: 'Markdown', icon: '¶' },
  { type: 'embedded', label: 'App Launcher', icon: '▶' },
];

export const ContextMenu: React.FC<Props> = ({ x, y, onAdd, onClose }) => {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        backgroundColor: '#2a2a2a',
        border: '1px solid #3a3a3a',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        minWidth: 200,
      }}
    >
      {MENU_ITEMS.map((item) => (
        <div
          key={item.type}
          onClick={() => onAdd(item.type)}
          style={{
            padding: '8px 14px',
            fontSize: 13,
            color: '#d0d0d0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span style={{ width: 18, textAlign: 'center' }}>{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
};
