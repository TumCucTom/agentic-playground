import React, { useEffect, useRef } from 'react';
import { Panel } from '../../shared/types';
import * as monaco from 'monaco-editor';
// Workers
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

interface Props {
  panel: Panel;
}

const SAMPLE_CODE = `// Welcome to the Canvas Workspace editor.
// Monaco is loaded. File editing is wired through the main process in a
// follow-up task — for now this is a scratch buffer.

function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet('Canvas'));
`;

export const EditorPanel: React.FC<Props> = ({ panel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: SAMPLE_CODE,
      language: 'javascript',
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

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};
