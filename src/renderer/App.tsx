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

  return (
    <>
      <TitleBar />
      <Toolbox />
      <Canvas />
    </>
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
