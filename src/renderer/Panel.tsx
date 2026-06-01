import React, { useState, useRef, useEffect } from 'react';
import { Panel as PanelType } from '../shared/types';
import { useCanvasStore } from './state/canvasStore';
import { TerminalPanel } from './panels/Terminal';
import { EditorPanel } from './panels/Editor';
import { FileExplorerPanel } from './panels/FileExplorer';
import { WebviewPanel } from './panels/Webview';
import { MarkdownPreviewPanel } from './panels/Markdown';
import { ExtensionPanel } from './panels/Extension';
import { EmbeddedPanel } from './panels/Embedded';
import { Tooltip } from './Tooltip';

interface PanelViewProps {
  panel: PanelType;
  isSelected: boolean;
  onFocus: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
  onTitleDoubleClick?: () => void;
  geometryOverride?: { x: number; y: number; width: number; height: number };
  dragDisabled?: boolean;
  // Used for the SE handle tooltip text — "Drag to resize · Double-click
  // to maximize" in canvas mode, "Drag to resize" in grid mode.
  resizeTooltipLabel?: string;
  // In grid mode, only the edges with a real divider behind them are
  // resizeable. The parent passes the allowed set so we can hide the
  // handles that would no-op (e.g., the left edge of the leftmost
  // panel). Undefined = all 8 directions (canvas mode).
  availableHandles?: Set<string>;
}

export const PanelView: React.FC<PanelViewProps> = ({
  panel,
  isSelected,
  onFocus,
  onDragStart,
  onResizeStart,
  onTitleDoubleClick,
  geometryOverride,
  dragDisabled = false,
  resizeTooltipLabel = 'Drag to resize',
  availableHandles,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const deletePanel = useCanvasStore((s) => s.deletePanel);
  const setPanelState = useCanvasStore((s) => s.setPanelState);

  const handleTitleBarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.panel-close, .panel-state-toggle')) return;
    e.stopPropagation();
    onFocus();
    if (dragDisabled) return;
    onDragStart(e);
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const up = () => setIsDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [isDragging]);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    deletePanel(panel.id);
  };

  const toggleState = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelState(panel.id, panel.state === 'running' ? 'idle' : 'running');
  };

  const stateColor = panel.state === 'running' ? '#ffa500' : '#3a3a3a';
  const stateTitle =
    panel.state === 'running'
      ? 'Running — click to mark idle'
      : 'Idle — click to mark running';

  return (
    <div
      className="panel"
      data-panel-id={panel.id}
      style={{
        position: 'absolute',
        left: geometryOverride?.x ?? panel.position.x,
        top: geometryOverride?.y ?? panel.position.y,
        width: geometryOverride?.width ?? panel.size.width,
        height: geometryOverride?.height ?? panel.size.height,
        backgroundColor: '#1f1f1f',
        border: `1px solid ${isSelected ? '#5a9fd4' : '#2a2a2a'}`,
        borderRadius: 6,
        boxShadow: isSelected
          ? '0 0 0 1px #5a9fd4, 0 4px 16px rgba(0, 0, 0, 0.4)'
          : '0 2px 8px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: panel.zOrder,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) {
          e.stopPropagation();
          onFocus();
        }
      }}
    >
      <div
        className="panel-titlebar"
        onMouseDown={handleTitleBarMouseDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onTitleDoubleClick?.();
        }}
        style={{
          height: 28,
          backgroundColor: '#252525',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 10,
          paddingRight: 6,
          cursor: dragDisabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
          flexShrink: 0,
          gap: 8,
        }}
      >
        <button
          className="panel-state-toggle"
          onClick={toggleState}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={stateTitle}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Tooltip label={stateTitle} side="bottom">
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: stateColor,
                boxShadow: panel.state === 'running' ? `0 0 6px ${stateColor}` : 'none',
                flexShrink: 0,
              }}
            />
          </Tooltip>
        </button>
        <div
          style={{
            flex: 1,
            fontSize: 12,
            color: '#d0d0d0',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {panel.title}
        </div>
        <Tooltip label="Close panel" side="bottom">
          <button
            className="panel-close"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Close panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: 16,
              cursor: 'pointer',
              padding: '0 6px',
              lineHeight: 1,
              borderRadius: 3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            ×
          </button>
        </Tooltip>
      </div>

      <div
        className="panel-content"
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <PanelContent panel={panel} />
      </div>

      <Tooltip label={resizeTooltipLabel} side="left">
        {(
          [
            'nw',
            'n',
            'ne',
            'e',
            'se',
            's',
            'sw',
            'w',
          ] as ResizeDirection[]
        )
          .filter((d) => !availableHandles || availableHandles.has(d))
          .map((d) => (
            <ResizeHandle
              key={d}
              direction={d}
              onMouseDown={(e) => {
                e.stopPropagation();
                onResizeStart(e, d);
              }}
            />
          ))}
      </Tooltip>
    </div>
  );
};

const PanelContent: React.FC<{ panel: PanelType }> = ({ panel }) => {
  switch (panel.type) {
    case 'terminal':
      return <TerminalPanel panel={panel} />;
    case 'editor':
      return <EditorPanel panel={panel} />;
    case 'fileExplorer':
      return <FileExplorerPanel panel={panel} />;
    case 'webview':
      return <WebviewPanel panel={panel} />;
    case 'markdownPreview':
      return <MarkdownPreviewPanel panel={panel} />;
    case 'extension':
      return <ExtensionPanel panel={panel} />;
    case 'embedded':
      return <EmbeddedPanel panel={panel} />;
    default:
      return <div style={{ padding: 16, color: '#888' }}>Unknown panel type</div>;
  }
};

type ResizeDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ResizeHandle: React.FC<{
  direction: ResizeDirection;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ direction, onMouseDown }) => {
  // Corners are 12×12, edges are 6px thick. N/NW/NE live below the
  // 28px title bar so they don't fight the title-bar drag.
  const style: React.CSSProperties = (() => {
    switch (direction) {
      case 'nw':
        return { position: 'absolute', top: 28, left: 0, width: 12, height: 12, cursor: 'nwse-resize' };
      case 'n':
        return { position: 'absolute', top: 28, left: 12, right: 12, height: 6, cursor: 'ns-resize' };
      case 'ne':
        return { position: 'absolute', top: 28, right: 0, width: 12, height: 12, cursor: 'nesw-resize' };
      case 'e':
        return { position: 'absolute', right: 0, top: 28, bottom: 12, width: 6, cursor: 'ew-resize' };
      case 'se':
        return { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, cursor: 'nwse-resize' };
      case 's':
        return { position: 'absolute', left: 12, right: 12, bottom: 0, height: 6, cursor: 'ns-resize' };
      case 'sw':
        return { position: 'absolute', bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize' };
      case 'w':
        return { position: 'absolute', left: 0, top: 28, bottom: 12, width: 6, cursor: 'ew-resize' };
    }
  })();

  return (
    <div
      className={`resize-handle resize-${direction}`}
      onMouseDown={onMouseDown}
      style={{ ...style, zIndex: 1 }}
    />
  );
};
