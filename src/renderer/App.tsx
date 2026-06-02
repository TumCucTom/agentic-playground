import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from './Canvas';
import { Toolbox } from './Toolbox';
import { useCanvasStore } from './state/canvasStore';
import { Tooltip } from './Tooltip';
import { LayoutModeToggle } from './layout/LayoutModeToggle';
import {
  BackgroundPicker,
  BackgroundMode,
  loadBackgroundMode,
  saveBackgroundMode,
} from './BackgroundPicker';
import { SessionMenu } from './SessionMenu';

export const App: React.FC = () => {
  const initialize = useCanvasStore((s) => s.initialize);
  const isDirty = useCanvasStore((s) => s.isDirty);
  const markClean = useCanvasStore((s) => s.markClean);
  const serialize = useCanvasStore((s) => s.serialize);
  const refreshSessions = useCanvasStore((s) => s.refreshSessions);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((state: ReturnType<typeof serialize>) => {
    return window.canvasAPI.saveCanvas(state);
  }, []);

  const [background, setBackground] = useState<BackgroundMode>(() => {
    const initial = loadBackgroundMode();
    // Apply to the BrowserWindow on first paint
    void window.canvasAPI.setWindowBackground(initial).catch(() => {});
    return initial;
  });

  const handleBackgroundChange = useCallback((mode: BackgroundMode) => {
    setBackground(mode);
    saveBackgroundMode(mode);
    void window.canvasAPI.setWindowBackground(mode).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await window.canvasAPI.loadCanvas();
        if (cancelled) return;
        initialize(state);
        // Populate the session list so the menu can render the
        // current name plus the rest. Cheap call; safe to fire-and-
        // forget (refreshSessions sets state on resolve).
        void refreshSessions();
      } catch (err) {
        console.error('Failed to load canvas state:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialize, refreshSessions]);

  // Auto-save with debounce
  useEffect(() => {
    if (!isDirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        void persist(serialize());
        markClean();
      } catch (err) {
        console.error('Failed to save canvas state:', err);
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [isDirty, serialize, persist, markClean]);

  // Cmd+S forces save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        try {
          void persist(serialize());
          markClean();
        } catch (err) {
          console.error('Failed to save canvas state:', err);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [persist, serialize, markClean]);

  // ESC clears panel selection. Skipped when a text input, textarea,
  // or contenteditable is focused so it doesn't interfere with the
  // editor/terminal/rename flows that use ESC for their own purposes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      e.preventDefault();
      useCanvasStore.getState().setSelected([]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
      <TitleBar background={background} onBackgroundChange={handleBackgroundChange} />
      <Toolbox />
      <Canvas background={background} />
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
      <Tooltip label="Layout: 1 Big + N Small" side="bottom">
        <button
          onClick={() => applyOneBigNSmall(selected.map((p) => p.id))}
          aria-label="Apply 1 Big + N Small layout"
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
        >
          1 Big + N Small
        </button>
      </Tooltip>
    </div>
  );
};

const TitleBar: React.FC<{
  background: BackgroundMode;
  onBackgroundChange: (mode: BackgroundMode) => void;
}> = ({ background, onBackgroundChange }) => {
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
        zIndex: 2000,
      }}
    >
      {/* Drag region for moving the window. Offset 5px from the top so
          the OS resize handle at the very top of the window stays free
          — covering it with a drag region blocks window resize. */}
      <div
        style={{
          position: 'absolute',
          top: 5,
          left: 0,
          right: 0,
          bottom: 0,
          WebkitAppRegion: 'drag',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 80,
          paddingRight: 14,
          fontSize: 12,
          color: '#888',
          gap: 8,
        }}
      >
        <span>Canvas Workspace</span>
        <span style={{ color: '#666' }}>·</span>
        <SessionMenu />
        <div style={{ marginLeft: 'auto', WebkitAppRegion: 'no-drag', display: 'flex', gap: 8, alignItems: 'center' }}>
          <LayoutModeToggle />
          <BackgroundPicker mode={background} onChange={onBackgroundChange} />
        </div>
      </div>
    </div>
  );
};
