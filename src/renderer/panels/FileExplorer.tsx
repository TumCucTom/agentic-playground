import React, { useEffect, useState } from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
  children?: FileEntry[];
}

export const FileExplorerPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'fileExplorer' ? panel.content.ref : null;
  const rootPath = ref?.rootPath ?? '/';
  const [tree, setTree] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    (async () => {
      try {
        const result = (await (window as any).canvasAPI?.listDirectory?.(rootPath)) as
          | FileEntry[]
          | null
          | undefined;
        if (cancelled) return;
        if (result) {
          setTree(result);
        } else {
          // Stub tree if backend is not wired
          setTree([
            { name: 'src', isDir: true, path: rootPath + '/src', children: [] },
            { name: 'package.json', isDir: false, path: rootPath + '/package.json' },
            { name: 'README.md', isDir: false, path: rootPath + '/README.md' },
          ]);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, ref]);

  const toggle = (path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderEntry = (entry: FileEntry, depth: number): React.ReactNode => {
    const isExpanded = expanded.has(entry.path);
    return (
      <div key={entry.path}>
        <div
          onClick={() => entry.isDir && toggle(entry.path)}
          style={{
            paddingLeft: 8 + depth * 14,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            fontSize: 12,
            color: entry.isDir ? '#d0d0d0' : '#a0a0a0',
            cursor: entry.isDir ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: '"SF Mono", Menlo, monospace',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a2a')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span style={{ width: 12, color: '#666' }}>{entry.isDir ? (isExpanded ? '▾' : '▸') : ''}</span>
          <span>{entry.isDir ? '📁' : '📄'}</span>
          <span>{entry.name}</span>
        </div>
        {entry.isDir && isExpanded && entry.children?.map((c) => renderEntry(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#1a1a1a' }}>
      <div
        style={{
          padding: '6px 10px',
          fontSize: 11,
          color: '#666',
          borderBottom: '1px solid #2a2a2a',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {rootPath}
      </div>
      {error ? (
        <div style={{ padding: 10, color: '#cc6666', fontSize: 12 }}>{error}</div>
      ) : tree ? (
        <div style={{ padding: '4px 0' }}>{tree.map((e) => renderEntry(e, 0))}</div>
      ) : (
        <div style={{ padding: 10, color: '#666', fontSize: 12 }}>Loading...</div>
      )}
    </div>
  );
};
