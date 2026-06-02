import React, { useEffect, useState } from 'react';
import { PanelType } from '../shared/types';
import { useCanvasStore } from './state/canvasStore';
import { createPanelOfType } from './panels/factory';
import { viewportToCanvas } from './utils/coordinates';
import { Tooltip } from './Tooltip';
import { WEB_APPS, WebApp } from './webApps';

const TOOLBOX_TOOLS: { type: PanelType; label: string; icon: string; shortcut?: string }[] = [
  { type: 'terminal', label: 'Terminal', icon: '⌨', shortcut: '⌘T' },
  { type: 'editor', label: 'Editor', icon: '✎' },
  { type: 'fileExplorer', label: 'Files', icon: '📁' },
  { type: 'webview', label: 'Web', icon: '🌐' },
  { type: 'markdownPreview', label: 'Markdown', icon: '¶' },
  { type: 'embedded', label: 'App Launcher', icon: '▶' },
];

const WEB_APPS_STORAGE_KEY = 'canvas-toolbox-webapps';

// Web app icons the user has pinned to the sidebar. The right-click
// menu lets them remove individual entries; "Restore defaults" puts
// the full curated catalog back.
const DEFAULT_WEB_APP_IDS = WEB_APPS.map((a) => a.id);

function loadWebAppIds(): string[] {
  try {
    const raw = localStorage.getItem(WEB_APPS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return parsed.filter((id) => WEB_APPS.some((a) => a.id === id));
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_WEB_APP_IDS;
}

function saveWebAppIds(ids: string[]) {
  try {
    localStorage.setItem(WEB_APPS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export const Toolbox: React.FC = () => {
  const addPanel = useCanvasStore((s) => s.addPanel);
  const focusPanel = useCanvasStore((s) => s.focusPanel);
  const viewport = useCanvasStore((s) => s.viewport);
  const [webAppIds, setWebAppIds] = useState<string[]>(loadWebAppIds);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  useEffect(() => saveWebAppIds(webAppIds), [webAppIds]);

  // Drop a panel roughly in the centre of the visible canvas, shifted
  // right of the toolbox so it isn't hidden by it.
  const canvasCenter = (): { x: number; y: number } => {
    const screenX = 56 + (window.innerWidth - 56) / 2;
    const screenY = 28 + (window.innerHeight - 28) / 2;
    return viewportToCanvas(screenX, screenY, viewport);
  };

  const handleAdd = (type: PanelType) => {
    const pt = canvasCenter();
    addPanel(createPanelOfType(type, pt.x, pt.y));
  };

  // Open a web app in its own webview panel at the canvas center. The
  // webview tag is given a per-panel session partition, so two
  // instances of the same app are two different accounts.
  const openWebApp = (app: WebApp) => {
    const pt = canvasCenter();
    const panel = createPanelOfType('webview', pt.x, pt.y, { url: app.url });
    panel.title = app.name;
    addPanel(panel);
    queueMicrotask(() => focusPanel(panel.id));
  };

  const removeWebApp = (index: number) => {
    setWebAppIds((prev) => prev.filter((_, i) => i !== index));
  };

  const restoreDefaults = () => setWebAppIds(DEFAULT_WEB_APP_IDS);

  const onContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setMenu({ index, x: e.clientX, y: e.clientY });
  };

  // Close context menu on outside click.
  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [menu]);

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 28,
        bottom: 0,
        width: 56,
        backgroundColor: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 6,
        zIndex: 1000,
        WebkitAppRegion: 'drag',
      }}
    >
      {TOOLBOX_TOOLS.map((item) => (
        <Tooltip key={item.type} label={item.label} shortcut={item.shortcut} side="right">
          <button
            onClick={() => handleAdd(item.type)}
            aria-label={item.label}
            style={iconButtonStyle}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}

      <div aria-hidden style={dividerStyle} />

      {webAppIds.map((id, i) => {
        const app = WEB_APPS.find((a) => a.id === id);
        if (!app) return null;
        return (
          <Tooltip key={id} label={app.name} side="right">
            <button
              onClick={() => openWebApp(app)}
              onContextMenu={(e) => onContextMenu(e, i)}
              aria-label={`Open ${app.name}`}
              data-testid={`toolbox-webapp-${id}`}
              style={iconButtonStyle}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
            >
              {app.icon}
            </button>
          </Tooltip>
        );
      })}

      {webAppIds.length === 0 && (
        <Tooltip label="Right-click to restore web apps" side="right">
          <button
            onClick={restoreDefaults}
            aria-label="Restore default web apps"
            style={{
              ...iconButtonStyle,
              border: '1px dashed #3a3a3a',
              color: '#666',
              fontSize: 14,
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ index: -1, x: e.clientX, y: e.clientY });
            }}
          >
            +
          </button>
        </Tooltip>
      )}

      {menu && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            background: '#2a2a2a',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            padding: 4,
            zIndex: 5000,
            minWidth: 180,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.index >= 0 && (
            <>
              <MenuItem
                label="Open in browser"
                onClick={() => {
                  const app = WEB_APPS.find((a) => a.id === webAppIds[menu.index]);
                  if (app) void window.canvasAPI.openExternal(app.url);
                  setMenu(null);
                }}
              />
              <MenuItem
                label="Remove from sidebar"
                onClick={() => {
                  removeWebApp(menu.index);
                  setMenu(null);
                }}
              />
            </>
          )}
          <MenuItem
            label="Restore defaults"
            onClick={() => {
              setMenu(null);
              restoreDefaults();
            }}
          />
        </div>
      )}
    </div>
  );
};

const iconButtonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 8,
  backgroundColor: 'transparent',
  border: '1px solid transparent',
  color: '#d0d0d0',
  fontSize: 18,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
};

const dividerStyle: React.CSSProperties = {
  width: 28,
  height: 1,
  backgroundColor: '#2a2a2a',
  margin: '6px 0',
};

const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.backgroundColor = '#2a2a2a';
  e.currentTarget.style.borderColor = '#3a3a3a';
};
const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.backgroundColor = 'transparent';
  e.currentTarget.style.borderColor = 'transparent';
};

const MenuItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    role="menuitem"
    onClick={onClick}
    style={{
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '6px 10px',
      background: 'transparent',
      border: 'none',
      color: '#d0d0d0',
      fontSize: 12,
      cursor: 'pointer',
      borderRadius: 3,
      fontFamily: 'inherit',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3a3a3a')}
    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
  >
    {label}
  </button>
);
