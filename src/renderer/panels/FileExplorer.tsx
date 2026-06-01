import React, { useEffect, useState } from 'react';
import { Panel } from '../../shared/types';
import { FileEntry } from '../../preload';

interface Props {
  panel: Panel;
}

export const FileExplorerPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'fileExplorer' ? panel.content.ref : null;
  const rootPath = ref?.rootPath ?? '/';
  const [tree, setTree] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingDirs((s) => new Set(s).add(rootPath));
        const result = await window.canvasAPI.listDirectory(rootPath);
        if (cancelled) return;
        setTree(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        setLoadingDirs((s) => {
          const next = new Set(s);
          next.delete(rootPath);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, ref]);

  const toggle = async (entry: FileEntry) => {
    const isExpanded = expanded.has(entry.path);
    if (isExpanded) {
      setExpanded((s) => {
        const next = new Set(s);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    setExpanded((s) => new Set(s).add(entry.path));
    // Lazy-load children if not loaded
    if (!entry.children) {
      setLoadingDirs((s) => new Set(s).add(entry.path));
      try {
        const children = await window.canvasAPI.listDirectory(entry.path);
        setTree((currentTree) => updateChildren(currentTree, entry.path, children));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingDirs((s) => {
          const next = new Set(s);
          next.delete(entry.path);
          return next;
        });
      }
    }
  };

  const updateChildren = (
    nodes: FileEntry[] | null,
    parentPath: string,
    children: FileEntry[]
  ): FileEntry[] => {
    if (!nodes) return nodes;
    return nodes.map((n) => {
      if (n.path === parentPath) {
        return { ...n, children };
      }
      if (n.children) {
        return { ...n, children: updateChildren(n.children, parentPath, children) };
      }
      return n;
    });
  };

  const onFileClick = (entry: FileEntry) => {
    if (entry.isDir) {
      toggle(entry);
      return;
    }
    // Open file in editor via custom event
    window.dispatchEvent(
      new CustomEvent('canvas:openFile', { detail: { filePath: entry.path } })
    );
  };

  const renderEntry = (entry: FileEntry, depth: number): React.ReactNode => {
    const isExpanded = expanded.has(entry.path);
    const isLoading = loadingDirs.has(entry.path);
    return (
      <div key={entry.path}>
        <div
          onClick={() => onFileClick(entry)}
          style={{
            paddingLeft: 8 + depth * 14,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            fontSize: 12,
            color: entry.isDir ? '#d0d0d0' : '#a0a0a0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: '"SF Mono", Menlo, monospace',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a2a')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span style={{ width: 12, color: '#666' }}>
            {entry.isDir ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span>{entry.isDir ? '📁' : '📄'}</span>
          <span>{entry.name}</span>
          {isLoading && <span style={{ color: '#666', fontSize: 10 }}>…</span>}
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
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={rootPath}
      >
        {rootPath}
      </div>
      {error ? (
        <div style={{ padding: 10, color: '#cc6666', fontSize: 12 }}>{error}</div>
      ) : tree ? (
        <div style={{ padding: '4px 0' }}>{tree.map((e) => renderEntry(e, 0))}</div>
      ) : (
        <div style={{ padding: 10, color: '#666', fontSize: 12 }}>Loading…</div>
      )}
    </div>
  );
};
