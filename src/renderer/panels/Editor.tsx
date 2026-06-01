import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '../../shared/types';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { useCanvasStore } from '../state/canvasStore';

(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

interface Props {
  panel: Panel;
}

function detectLanguage(filePath: string | null): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'yaml':
    case 'yml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

export const EditorPanel: React.FC<Props> = ({ panel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updatePanel = useCanvasStore((s) => s.updatePanel);

  const ref = panel.content.type === 'editor' ? panel.content.ref : null;
  const filePath = ref?.filePath ?? null;

  // Load file when filePath changes
  useEffect(() => {
    if (!filePath) {
      // No file: just create with sample
      if (editorRef.current) {
        editorRef.current.setValue('// Empty editor. Open a file from the File Explorer.');
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const content = await window.canvasAPI.readFile(filePath);
        if (cancelled || !editorRef.current) return;
        editorRef.current.setValue(content);
        const lang = detectLanguage(filePath);
        monaco.editor.setModelLanguage(editorRef.current.getModel()!, lang);
        setDirty(false);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Listen for "open file" events from FileExplorer
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { filePath: string };
      if (editorRef.current && detail?.filePath) {
        updatePanel(panel.id, {
          content: {
            type: 'editor',
            ref: { filePath: detail.filePath, language: detectLanguage(detail.filePath) },
          },
          title: detail.filePath.split('/').pop() || 'Editor',
        });
      }
    };
    window.addEventListener('canvas:openFile', handler);
    return () => window.removeEventListener('canvas:openFile', handler);
  }, [panel.id, updatePanel]);

  // Save on Cmd+S when this editor is focused
  useEffect(() => {
    if (!filePath) return;
    const handler = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        // Only handle if our editor is focused
        if (document.activeElement && containerRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
          if (editorRef.current && filePath) {
            try {
              await window.canvasAPI.writeFile(filePath, editorRef.current.getValue());
              setDirty(false);
            } catch (err) {
              setError(`Save failed: ${(err as Error).message}`);
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filePath]);

  // Create the editor on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'vs-dark',
      automaticLayout: true,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderLineHighlight: 'all',
    });
    editorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '4px 8px',
            background: '#5a1f1f',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          {error}
        </div>
      )}
      {dirty && (
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
          ● unsaved
        </div>
      )}
    </div>
  );
};
