import React, { useEffect, useRef } from 'react';
import { Canvas } from './Canvas';
import { Toolbox } from './Toolbox';
import { useCanvasStore } from './state/canvasStore';
import { CanvasAPI } from '../preload';

declare global {
  interface Window {
    canvasAPI: CanvasAPI;
  }
}

export const App: React.FC = () => {
  const initialize = useCanvasStore((s) => s.initialize);
  const saveCanvas = useCanvasStore((s) => s.saveCanvas);
  const isDirty = useCanvasStore((s) => s.isDirty);
  const markClean = useCanvasStore((s) => s.markClean);
  const serialize = useCanvasStore((s) => s.serialize);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await window.canvasAPI.loadCanvas();
        if (cancelled) return;
        initialize(state);
      } catch (err) {
        console.error('Failed to load canvas state:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialize]);

  // Auto-save with debounce
  useEffect(() => {
    if (!isDirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        void saveCanvas(serialize());
        markClean();
      } catch (err) {
        console.error('Failed to save canvas state:', err);
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [isDirty, serialize, saveCanvas, markClean]);

  // Cmd+S forces save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        try {
          void saveCanvas(serialize());
          markClean();
        } catch (err) {
          console.error('Failed to save canvas state:', err);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveCanvas, serialize, markClean]);

  // Auto-focus + auto-promote on task completion (smart orchestration)
  useEffect(() => {
    const unsubscribe = window.canvasAPI.onTaskCompleted((payload) => {
      const state = useCanvasStore.getState();
      // Mark the panel as idle
      state.setPanelState(payload.panelId, 'idle');
      // Find the panel and bring it into view + focus
      const panel = state.panels.find((p) => p.id === payload.panelId);
      if (!panel) return;
      // Don't auto-focus if the user is already focused on it
      const userAlreadyFocused = state.selectedPanelIds.includes(payload.panelId);
      state.focusPanel(payload.panelId);

      // Auto-promote: if there are other Running panels, apply
      // 1 Big + N Small with the just-completed one as the big.
      const otherRunning = state.panels.filter(
        (p) => p.state === 'running' && p.id !== payload.panelId
      );
      if (otherRunning.length > 0) {
        state.applyOneBigNSmall([payload.panelId, ...otherRunning.map((p) => p.id)]);
      }

      // Pan the canvas so the panel is visible (unless user was already focused)
      if (userAlreadyFocused) return;
      const viewport = state.viewport;
      const padding = 100;
      const targetX = panel.position.x + panel.size.width / 2;
      const targetY = panel.position.y + panel.size.height / 2;
      const viewportWorldW = window.innerWidth / viewport.zoom;
      const viewportWorldH = window.innerHeight / viewport.zoom;
      const visibleX = viewport.x - padding / viewport.zoom;
      const visibleY = viewport.y - padding / viewport.zoom;
      const visibleW = viewportWorldW + (padding * 2) / viewport.zoom;
      const visibleH = viewportWorldH + (padding * 2) / viewport.zoom;
      if (
        targetX < visibleX ||
        targetX > visibleX + visibleW ||
        targetY < visibleY ||
        targetY > visibleY + visibleH
      ) {
        state.setViewport({
          x: targetX - viewportWorldW / 2,
          y: targetY - viewportWorldH / 2,
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <>
      <TitleBar />
      <Toolbox />
      <Canvas />
      <LayoutToolbar />
    </>
  );
};

const LayoutToolbar: React.FC = () => {
  const panels = useCanvasStore((s) => s.panels);
  const selectedPanelIds = useCanvasStore((s) => s.selectedPanelIds);
  const applyOneBigNSmall = useCanvasStore((s) => s.applyOneBigNSmall);

  const terminals = panels.filter((p) => p.type === 'terminal');
  const selected = selectedPanelIds.length > 0
    ? panels.filter((p) => selectedPanelIds.includes(p.id))
    : terminals;

  if (selected.length < 2) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 36,
        left: 70,
        display: 'flex',
        gap: 6,
        zIndex: 1500,
        pointerEvents: 'auto',
      }}
    >
      <button
        onClick={() => applyOneBigNSmall(selected.map((p) => p.id))}
        style={{
          padding: '6px 10px',
          background: '#2a2a2a',
          color: '#d0d0d0',
          border: '1px solid #3a3a3a',
          borderRadius: 4,
          fontSize: 11,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#2a2a2a')}
        title="Layout: 1 Big + N Small"
      >
        1 Big + N Small
      </button>
    </div>
  );
};

const TitleBar: React.FC = () => {
  const workspaceName = useCanvasStore((s) => s.workspaceName);
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 28,
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        WebkitAppRegion: 'drag',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 80,
        paddingRight: 14,
        fontSize: 12,
        color: '#888',
        zIndex: 2000,
      }}
    >
      <span>Canvas Workspace</span>
      <span style={{ marginLeft: 10, color: '#666' }}>·</span>
      <span style={{ marginLeft: 10 }}>{workspaceName}</span>
    </div>
  );
};
