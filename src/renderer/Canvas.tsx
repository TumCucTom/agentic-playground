import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useCanvasStore } from './state/canvasStore';
import { PanelView } from './Panel';
import { ContextMenu } from './ContextMenu';
import { viewportToCanvas } from './utils/coordinates';
import { PanelType } from '../shared/types';
import { createPanelOfType } from './panels/factory';
import { BackgroundMode } from './BackgroundPicker';
import { GridLayout } from './layout/GridLayout';
import { snap, SnapGuide } from './layout/snapEngine';
import { SnapGuides } from './layout/SnapGuides';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

interface CanvasProps {
  background: BackgroundMode;
}

export const Canvas: React.FC<CanvasProps> = ({ background }) => {
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
  const layoutMode = useCanvasStore((s) => s.layoutMode);
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

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const cmdHeldRef = useRef(false);

  // Detect OS color scheme for 'system' background
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  );
  useEffect(() => {
    if (background !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [background]);

  const resolvedBackground: 'black' | 'white' | 'translucent' = useMemo(() => {
    if (background === 'system') return systemDark ? 'black' : 'white';
    return background;
  }, [background, systemDark]);

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
        const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
        zoomViewport(factor, mouseX, mouseY);
      } else {
        // Pan — content follows finger (natural scroll)
        panViewport(e.deltaX / viewport.zoom, e.deltaY / viewport.zoom);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [panViewport, zoomViewport, viewport.zoom]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
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
        useCanvasStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
      } else if (e.key === '=' && (e.metaKey || e.ctrlKey)) {
        zoomViewport(1.1);
      } else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        zoomViewport(1 / 1.1);
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
      } else if (e.key === 'l' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        const current = useCanvasStore.getState().layoutMode;
        useCanvasStore.getState().setLayoutMode(current === 'canvas' ? 'grid' : 'canvas');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedPanelIds, setSelected, zoomViewport]);

  // Track Cmd key to disable snap during drag (snap is enabled by default in canvas mode).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) cmdHeldRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) cmdHeldRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Sort panels by zOrder for rendering
  const sortedPanels = React.useMemo(
    () => [...panels].sort((a, b) => a.zOrder - b.zOrder),
    [panels]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && e.shiftKey && e.metaKey)) {
        e.preventDefault();
        dragStateRef.current = {
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
        };
        setSelected([]);
      } else if (e.button === 0 && e.target === e.currentTarget) {
        setSelected([]);
      }
    },
    [setSelected]
  );

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
        const rawX = (drag.startPanelX ?? 0) + dx / viewport.zoom;
        const rawY = (drag.startPanelY ?? 0) + dy / viewport.zoom;
        const draggedPanel = panels.find((p) => p.id === drag.panelId);
        if (draggedPanel) {
          const otherRects = panels
            .filter((p) => p.id !== drag.panelId)
            .map((p) => ({ x: p.position.x, y: p.position.y, w: p.size.width, h: p.size.height }));
          const viewportRect = {
            x: viewport.x,
            y: viewport.y,
            w: window.innerWidth / viewport.zoom,
            h: window.innerHeight / viewport.zoom,
          };
          const result = snap({
            dragRect: { x: rawX, y: rawY, w: draggedPanel.size.width, h: draggedPanel.size.height },
            otherRects,
            viewportRect,
            zoom: viewport.zoom,
            thresholdPx: 8,
            disabled: cmdHeldRef.current,
          });
          setSnapGuides(result.guides);
          movePanel(drag.panelId, { x: result.rect.x, y: result.rect.y });
        }
      } else if (drag.type === 'resize' && drag.panelId) {
        const newW = Math.max(150, (drag.startPanelW ?? 0) + dx / viewport.zoom);
        const newH = Math.max(100, (drag.startPanelH ?? 0) + dy / viewport.zoom);
        resizePanel(drag.panelId, newW, newH);
      }
    };

    const handleMouseUp = () => {
      dragStateRef.current = { type: null, startX: 0, startY: 0 };
      setSnapGuides([]);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [viewport.zoom, panViewport, movePanel, resizePanel]);

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

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // Build the background style based on the current mode
  const bgStyle: React.CSSProperties = (() => {
    const dotSize = 20 * viewport.zoom;
    const dotPos = `${-viewport.x * viewport.zoom}px ${-viewport.y * viewport.zoom}px`;
    if (resolvedBackground === 'translucent') {
      return {
        backgroundColor: 'transparent',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)',
        backgroundSize: `${dotSize}px ${dotSize}px`,
        backgroundPosition: dotPos,
      };
    }
    if (resolvedBackground === 'white') {
      return {
        backgroundColor: '#ffffff',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.18) 1px, transparent 0)',
        backgroundSize: `${dotSize}px ${dotSize}px`,
        backgroundPosition: dotPos,
      };
    }
    // black / system-dark
    return {
      backgroundColor: '#0f0f0f',
      backgroundImage:
        'radial-gradient(circle at 1px 1px, #2a2a2a 1px, transparent 0)',
      backgroundSize: `${dotSize}px ${dotSize}px`,
      backgroundPosition: dotPos,
    };
  })();

  if (layoutMode === 'grid') {
    return <GridLayout />;
  }

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
        ...bgStyle,
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
      <SnapGuides guides={snapGuides} viewport={viewport} />
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
