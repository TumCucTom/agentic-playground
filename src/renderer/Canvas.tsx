import React, { useRef, useEffect, useCallback } from 'react';
import { useCanvasStore } from './state/canvasStore';
import { PanelView } from './Panel';
import { ContextMenu } from './ContextMenu';
import { viewportToCanvas } from './utils/coordinates';
import { PanelType } from '../shared/types';
import { createPanelOfType } from './panels/factory';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

export const Canvas: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    type: 'pan' | 'move' | 'resize' | null;
    startX: number;
    startY: number;
    panelId?: string;
    startPanelX?: number;
    startPanelY?: number;
    startPanelW?: number;
    startPanelH?: number;
    resizeHandle?: string;
  }>({ type: null, startX: 0, startY: 0 });

  const panels = useCanvasStore((s) => s.panels);
  const viewport = useCanvasStore((s) => s.viewport);
  const selectedPanelIds = useCanvasStore((s) => s.selectedPanelIds);
  const panViewport = useCanvasStore((s) => s.panViewport);
  const zoomViewport = useCanvasStore((s) => s.zoomViewport);
  const focusPanel = useCanvasStore((s) => s.focusPanel);
  const setSelected = useCanvasStore((s) => s.setSelected);
  const movePanel = useCanvasStore((s) => s.movePanel);
  const resizePanel = useCanvasStore((s) => s.resizePanel);
  const addPanel = useCanvasStore((s) => s.addPanel);

  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  // Wheel handler for pan and zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.metaKey || e.ctrlKey) {
        // Zoom
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomViewport(factor, mouseX, mouseY);
      } else {
        // Pan
        panViewport(-e.deltaX / viewport.zoom, -e.deltaY / viewport.zoom);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [panViewport, zoomViewport, viewport.zoom]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Escape') {
        setSelected([]);
        setContextMenu(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPanelIds.length > 0) {
          selectedPanelIds.forEach((id) => useCanvasStore.getState().deletePanel(id));
        }
      } else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        // Fit to view
        useCanvasStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
      } else if (e.key === '=' && (e.metaKey || e.ctrlKey)) {
        zoomViewport(1.2);
      } else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        zoomViewport(1 / 1.2);
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        useCanvasStore.getState().undo();
      } else if (
        ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
          (e.key === 'Z' && (e.metaKey || e.ctrlKey))) ||
        (e.key === 'y' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        useCanvasStore.getState().redo();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedPanelIds, setSelected, zoomViewport]);

  // Sort panels by zOrder for rendering
  const sortedPanels = React.useMemo(() => [...panels].sort((a, b) => a.zOrder - b.zOrder), [panels]);

  // Mouse down on empty canvas: start panning
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && e.shiftKey && e.metaKey)) {
        // Middle button, or alt+click, or cmd+shift+click = pan
        e.preventDefault();
        dragStateRef.current = {
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
        };
        setSelected([]);
      } else if (e.button === 0 && e.target === e.currentTarget) {
        // Plain click on empty canvas
        setSelected([]);
      }
    },
    [setSelected]
  );

  // Mouse move handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (drag.type === null) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === 'pan') {
        panViewport(dx / viewport.zoom, dy / viewport.zoom);
        dragStateRef.current.startX = e.clientX;
        dragStateRef.current.startY = e.clientY;
      } else if (drag.type === 'move' && drag.panelId) {
        const newX = (drag.startPanelX ?? 0) + dx / viewport.zoom;
        const newY = (drag.startPanelY ?? 0) + dy / viewport.zoom;
        movePanel(drag.panelId, { x: newX, y: newY });
      } else if (drag.type === 'resize' && drag.panelId) {
        const newW = Math.max(150, (drag.startPanelW ?? 0) + dx / viewport.zoom);
        const newH = Math.max(100, (drag.startPanelH ?? 0) + dy / viewport.zoom);
        resizePanel(drag.panelId, newW, newH);
      }
    };

    const handleMouseUp = () => {
      dragStateRef.current = { type: null, startX: 0, startY: 0 };
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [viewport.zoom, panViewport, movePanel, resizePanel]);

  // Right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const canvasPt = viewportToCanvas(mouseX, mouseY, viewport);
      setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPt.x, canvasY: canvasPt.y });
    },
    [viewport]
  );

  const handleAddPanel = useCallback(
    (type: PanelType) => {
      if (!contextMenu) return;
      const panel = createPanelOfType(type, contextMenu.canvasX, contextMenu.canvasY);
      addPanel(panel);
      setContextMenu(null);
    },
    [contextMenu, addPanel]
  );

  // Click outside context menu closes it
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  return (
    <div
      ref={canvasRef}
      className="canvas-root"
      onMouseDown={handleCanvasMouseDown}
      onContextMenu={handleContextMenu}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        backgroundColor: '#0f0f0f',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, #2a2a2a 1px, transparent 0)',
        backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
        backgroundPosition: `${-viewport.x * viewport.zoom}px ${-viewport.y * viewport.zoom}px`,
        cursor: dragStateRef.current.type === 'pan' ? 'grabbing' : 'default',
      }}
    >
      <div
        style={{
          position: 'absolute',
          transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          width: 0,
          height: 0,
        }}
      >
        {sortedPanels.map((panel) => (
          <PanelView
            key={panel.id}
            panel={panel}
            isSelected={selectedPanelIds.includes(panel.id)}
            onFocus={() => focusPanel(panel.id)}
            onDragStart={(e) => {
              dragStateRef.current = {
                type: 'move',
                startX: e.clientX,
                startY: e.clientY,
                panelId: panel.id,
                startPanelX: panel.position.x,
                startPanelY: panel.position.y,
              };
            }}
            onResizeStart={(e, handle) => {
              dragStateRef.current = {
                type: 'resize',
                startX: e.clientX,
                startY: e.clientY,
                panelId: panel.id,
                startPanelW: panel.size.width,
                startPanelH: panel.size.height,
                resizeHandle: handle,
              };
            }}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAdd={handleAddPanel}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ZoomIndicator />
    </div>
  );
};

const ZoomIndicator: React.FC = () => {
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        padding: '6px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        border: '1px solid #3a3a3a',
        borderRadius: 6,
        fontSize: 12,
        color: '#aaa',
        fontFamily: 'monospace',
        pointerEvents: 'none',
      }}
    >
      {Math.round(zoom * 100)}%
    </div>
  );
};
