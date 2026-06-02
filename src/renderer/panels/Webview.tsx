import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '../../shared/types';
import { useCanvasStore } from '../state/canvasStore';
import { Tooltip } from '../Tooltip';

// Derived in-component from panel.id, NOT stored in the content ref, so
// the JSON serialization stays stable across migrations. The same panel
// always gets the same partition, so cookies/storage survive reloads.
// Duplicating a panel (future) gets a fresh partition automatically.
export function partitionForPanel(id: string): string {
  return `persist:webview-${id}`;
}

interface Props {
  panel: Panel;
}

export const WebviewPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'webview' ? panel.content.ref : null;
  const url = ref?.url ?? '';
  const html = ref?.html;
  const updatePanel = useCanvasStore((s) => s.updatePanel);

  // localUrl tracks the URL the user is typing in the URL bar. It's
  // committed to the panel ref on did-navigate and on Enter.
  const [localUrl, setLocalUrl] = useState(url);
  const [isLoading, setIsLoading] = useState(false);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);

  useEffect(() => {
    setLocalUrl(url);
  }, [url]);

  // If the panel was just created with no URL, render a centered input
  // rather than pointing the webview at about:blank. about:blank shows
  // an empty white page and the user has no idea the URL bar is two
  // keystrokes away.
  if (!url && !html) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f0f0f',
          padding: 16,
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const target = e.currentTarget.elements.namedItem('url') as HTMLInputElement | null;
            const next = target?.value.trim();
            if (!next) return;
            updatePanel(panel.id, {
              content: { type: 'webview', ref: { url: next } },
              title: next,
            });
          }}
          style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 480 }}
        >
          <input
            name="url"
            type="text"
            placeholder="Enter a URL (e.g. https://example.com)"
            autoFocus
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#1a1a1a',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: 4,
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '8px 16px',
              background: '#2a2a2a',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Go
          </button>
        </form>
      </div>
    );
  }

  if (html) {
    // Existing srcDoc branch — html panels continue to render unchanged.
    return (
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        title={panel.title}
      />
    );
  }

  const handleNavBack = () => webviewRef.current?.goBack();
  const handleNavForward = () => webviewRef.current?.goForward();
  const handleReload = () => webviewRef.current?.reload();
  const handlePopOut = () => {
    const current = webviewRef.current?.getURL();
    if (current) void window.canvasAPI.openExternal(current);
  };
  const handleUrlSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = localUrl.trim();
    if (!raw) return;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setLocalUrl(normalized);
    if (webviewRef.current) webviewRef.current.src = normalized;
    updatePanel(panel.id, {
      content: { type: 'webview', ref: { url: normalized } },
      title: normalized,
    });
  };

  // Use unknown cast because Electron's WebviewTag typings don't expose
  // `new-window` even though the underlying Chromium event exists.
  const wv = webviewRef as unknown as React.MutableRefObject<HTMLElement | null>;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <UrlBar
        localUrl={localUrl}
        isLoading={isLoading}
        onChange={setLocalUrl}
        onSubmit={handleUrlSubmit}
        onBack={handleNavBack}
        onForward={handleNavForward}
        onReload={handleReload}
        onPopOut={handlePopOut}
      />
      {React.createElement('webview', {
        ref: wv as any,
        src: url,
        partition: partitionForPanel(panel.id),
        style: { flex: 1, width: '100%', border: 'none', background: '#fff' },
        // Per-webview flags override the BrowserWindow defaults. contextIsolation
        // and no nodeIntegration are non-negotiable for security; sandbox gives
        // us Chromium's process isolation on top.
        webpreferences: 'contextIsolation=yes,nodeIntegration=no,sandbox=yes',
        allowpopups: true,
        onDidStartLoading: () => setIsLoading(true),
        onDidStopLoading: () => setIsLoading(false),
        onDidNavigate: (e: { url: string }) => {
          setLocalUrl(e.url);
          updatePanel(panel.id, {
            content: { type: 'webview', ref: { url: e.url } },
          });
        },
        onPageTitleUpdated: (e: { title: string }) => {
          updatePanel(panel.id, { title: e.title });
        },
        onNewWindow: (e: { url: string }) => {
          // target=_blank, window.open, etc — forward to the user's
          // default browser rather than spawning an Electron BrowserWindow
          // we don't manage.
          void window.canvasAPI.openExternal(e.url);
        },
      } as any)}
    </div>
  );
};

const UrlBar: React.FC<{
  localUrl: string;
  isLoading: boolean;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onPopOut: () => void;
}> = ({ localUrl, isLoading, onChange, onSubmit, onBack, onForward, onReload, onPopOut }) => {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        flexShrink: 0,
      }}
    >
      <Tooltip label="Back" side="bottom">
        <NavButton onClick={onBack} aria-label="Back">‹</NavButton>
      </Tooltip>
      <Tooltip label="Forward" side="bottom">
        <NavButton onClick={onForward} aria-label="Forward">›</NavButton>
      </Tooltip>
      <Tooltip label="Reload" side="bottom">
        <NavButton onClick={onReload} aria-label="Reload">↻</NavButton>
      </Tooltip>
      <input
        type="text"
        value={localUrl}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter URL"
        spellCheck={false}
        style={{
          flex: 1,
          padding: '5px 10px',
          background: '#0f0f0f',
          color: '#d0d0d0',
          border: '1px solid #2a2a2a',
          borderRadius: 3,
          fontSize: 12,
          fontFamily: 'monospace',
          outline: 'none',
          minWidth: 0,
        }}
      />
      {isLoading && (
        <span
          aria-label="Loading"
          style={{
            width: 12,
            height: 12,
            border: '2px solid #3a3a3a',
            borderTopColor: '#5a9fd4',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            flexShrink: 0,
          }}
        />
      )}
      <Tooltip label="Open in default browser" side="bottom">
        <NavButton onClick={onPopOut} aria-label="Open in default browser">↗</NavButton>
      </Tooltip>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </form>
  );
};

const NavButton: React.FC<{
  onClick: () => void;
  'aria-label': string;
  children: React.ReactNode;
}> = ({ onClick, children, ...rest }) => (
  <button
    type="button"
    onClick={onClick}
    {...rest}
    style={{
      width: 26,
      height: 26,
      padding: 0,
      background: '#2a2a2a',
      color: '#d0d0d0',
      border: '1px solid #3a3a3a',
      borderRadius: 3,
      fontSize: 14,
      lineHeight: 1,
      cursor: 'pointer',
      fontFamily: 'inherit',
      flexShrink: 0,
    }}
  >
    {children}
  </button>
);
