import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '../../shared/types';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useCanvasStore } from '../state/canvasStore';

interface Props {
  panel: Panel;
}

export const TerminalPanel: React.FC<Props> = ({ panel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const setPanelState = useCanvasStore((s) => s.setPanelState);

  const ref = panel.content.type === 'terminal' ? panel.content.ref : null;
  const ptyId = ptyIdRef.current; // Used by cleanup
  void ptyId;

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#1e1e1e',
        foreground: '#d0d0d0',
        cursor: '#5a9fd4',
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // xterm 5.3.0 has a race: the render service's `dimensions` getter
    // throws if read before the renderer is wired up. Defer the first fit
    // until the next frame, and subscribe to onRender so subsequent
    // ResizeObserver ticks run after the renderer is ready.
    const initialFit = () => {
      try {
        fit.fit();
      } catch {
        // ignore — the ResizeObserver tick will retry once the renderer
        // is fully wired.
      }
    };
    const onFirstRender = term.onRender(() => {
      initialFit();
      onFirstRender.dispose();
    });
    const rafId = requestAnimationFrame(initialFit);
    termRef.current = term;
    fitRef.current = fit;

    let cancelled = false;
    let unsubscribeData: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;
    const ptyIdLocal = `pty_panel_${panel.id}`;
    ptyIdRef.current = ptyIdLocal;

    (async () => {
      try {
        const result = await window.canvasAPI.ptyCreate({
          shell: ref?.shell,
          cwd: ref?.cwd,
          cols: ref?.cols ?? 80,
          rows: ref?.rows ?? 24,
          panelId: panel.id,
        });
        if (cancelled) {
          // The component unmounted before the PTY was created
          await window.canvasAPI.ptyKill(result.id);
          return;
        }
        ptyIdRef.current = result.id;
        setRunning(true);
        setPanelState(panel.id, 'running');

        // Send initial resize based on actual terminal size
        try {
          const dims = fit.proposeDimensions();
          if (dims) {
            await window.canvasAPI.ptyResize(result.id, dims.cols, dims.rows);
          }
        } catch {
          // ignore
        }

        unsubscribeData = window.canvasAPI.onPtyData((id, data) => {
          if (id === result.id) term.write(data);
        });
        unsubscribeExit = window.canvasAPI.onPtyExit((id, code) => {
          if (id === result.id) {
            term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
            setRunning(false);
            setPanelState(panel.id, 'idle');
          }
        });

        term.onData((data) => {
          void window.canvasAPI.ptyWrite(result.id, data);
        });
      } catch (err) {
        if (!cancelled) {
          setError(`PTY unavailable: ${(err as Error).message}`);
          term.writeln(`\x1b[31mPTY unavailable: ${(err as Error).message}\x1b[0m`);
        }
      }
    })();

    const handleResize = () => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ptyIdRef.current) {
          void window.canvasAPI.ptyResize(ptyIdRef.current, dims.cols, dims.rows);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      onFirstRender.dispose();
      cancelAnimationFrame(rafId);
      if (unsubscribeData) unsubscribeData();
      if (unsubscribeExit) unsubscribeExit();
      if (ptyIdRef.current) {
        void window.canvasAPI.ptyKill(ptyIdRef.current);
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [panel.id, setPanelState, ref?.shell, ref?.cwd, ref?.cols, ref?.rows]);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#cc6666', fontSize: 12, fontFamily: 'monospace' }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#1e1e1e' }} />
      {running && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            padding: '2px 6px',
            background: 'rgba(255, 165, 0, 0.2)',
            color: '#ffa500',
            fontSize: 10,
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        >
          ● live
        </div>
      )}
    </div>
  );
};
