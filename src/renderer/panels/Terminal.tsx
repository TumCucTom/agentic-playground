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
  const [error, setError] = useState<string | null>(null);
  const setPanelState = useCanvasStore((s) => s.setPanelState);

  useEffect(() => {
    if (!containerRef.current) return;

    let term: XTerm;
    let fit: FitAddon;
    try {
      term = new XTerm({
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
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;
    } catch (err) {
      setError(`Failed to initialize terminal: ${(err as Error).message}`);
      return;
    }

    // We don't have node-pty available in the renderer directly, so render a
    // basic read-only terminal that echoes input. The real PTY integration
    // is wired through the main process IPC in a follow-up task.
    term.writeln('\x1b[36mCanvas Workspace Terminal\x1b[0m');
    term.writeln('PTY integration is wired through main process (see Task: Built-in panels).');
    term.writeln('Use Ctrl+L to clear, type to echo.\r\n');
    setPanelState(panel.id, 'idle');

    let buffer = '';
    term.onData((data) => {
      if (data === '\x7f') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }
      if (data === '\r') {
        term.writeln('');
        term.writeln(`echo: ${buffer}`);
        buffer = '';
        return;
      }
      if (data === '\x0c') {
        term.clear();
        return;
      }
      buffer += data;
      term.write(data);
    });

    const handleResize = () => {
      try {
        fit.fit();
      } catch {
        // ignore fit errors
      }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [panel.id, setPanelState]);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#cc6666', fontSize: 12, fontFamily: 'monospace' }}>
        {error}
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#1e1e1e' }} />;
};
