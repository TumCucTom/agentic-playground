import React, { useEffect, useState, useRef } from 'react';
import { Panel, PanelType, ContentRef } from '../shared/types';
import { useCanvasStore } from './state/canvasStore';
import { createPanelOfType } from './panels/factory';
import { viewportToCanvas } from './utils/coordinates';
import { Tooltip } from './Tooltip';
import { COMMON_APPS } from './commonApps';

const TOOLBOX_TOOLS: { type: PanelType; label: string; icon: string; shortcut?: string }[] = [
  { type: 'terminal', label: 'Terminal', icon: '⌨', shortcut: '⌘T' },
  { type: 'editor', label: 'Editor', icon: '✎' },
  { type: 'fileExplorer', label: 'Files', icon: '📁' },
  { type: 'webview', label: 'Web', icon: '🌐' },
  { type: 'markdownPreview', label: 'Markdown', icon: '¶' },
  { type: 'embedded', label: 'App Launcher', icon: '▶' },
];

const APPS_STORAGE_KEY = 'canvas-toolbox-apps';

// Default apps shown in the sidebar. The user can right-click any icon to
// remove it, or right-click the (empty) sidebar to add a custom bundle id
// or restore the defaults.
const DEFAULT_APP_IDS = [
  'com.google.Chrome',
  'com.microsoft.VSCode',
  'com.apple.Terminal',
  'com.apple.Safari',
  'com.apple.finder',
];

function loadApps(): string[] {
  try {
    const raw = localStorage.getItem(APPS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_IDS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_APP_IDS;
}

function saveApps(ids: string[]) {
  try {
    localStorage.setItem(APPS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function uuid(): string {
  return 'p_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export const Toolbox: React.FC = () => {
  const addPanel = useCanvasStore((s) => s.addPanel);
  const viewport = useCanvasStore((s) => s.viewport);
  const focusPanel = useCanvasStore((s) => s.focusPanel);
  const [appIds, setAppIds] = useState<string[]>(loadApps);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  useEffect(() => saveApps(appIds), [appIds]);

  const handleAdd = (type: PanelType) => {
    // Drop the panel roughly in the centre of the visible canvas,
    // shifted right of the toolbox so it isn't hidden by it.
    const screenX = 56 + (window.innerWidth - 56) / 2;
    const screenY = 28 + (window.innerHeight - 28) / 2;
    const canvasPt = viewportToCanvas(screenX, screenY, viewport);
    const panel = createPanelOfType(type, canvasPt.x, canvasPt.y);
    addPanel(panel);
  };

  // One-click app launch: create an App Launcher panel with the bundleId
  // pre-set, then focus it. The EmbeddedPanel auto-launches a new
  // instance of the app when it mounts and sees a non-empty bundleId.
  const launchApp = (bundleId: string) => {
    const screenX = 56 + (window.innerWidth - 56) / 2;
    const screenY = 28 + (window.innerHeight - 28) / 2;
    const canvasPt = viewportToCanvas(screenX, screenY, viewport);
    const content: ContentRef = { type: 'embedded', ref: { appBundleId: bundleId } };
    const appName = COMMON_APPS.find((a) => a.id === bundleId)?.name ?? bundleId;
    const panel: Panel = {
      id: uuid(),
      type: 'embedded',
      position: {
        x: canvasPt.x - 250,
        y: canvasPt.y - 180,
      },
      size: { width: 500, height: 360 },
      title: appName,
      state: 'running',
      zOrder: 0,
      content,
    };
    addPanel(panel);
    // Focus after add so it gets top z-order.
    queueMicrotask(() => focusPanel(panel.id));
  };

  const removeApp = (index: number) => {
    setAppIds((prev) => prev.filter((_, i) => i !== index));
  };

  const addCustom = () => {
    const id = window.prompt('Enter macOS bundle id (e.g. com.google.Chrome):');
    if (!id) return;
    const trimmed = id.trim();
    if (!trimmed) return;
    setAppIds((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const restoreDefaults = () => setAppIds(DEFAULT_APP_IDS);

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
            style={{
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
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2a2a2a';
              e.currentTarget.style.borderColor = '#3a3a3a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}

      <div
        aria-hidden
        style={{
          width: 28,
          height: 1,
          backgroundColor: '#2a2a2a',
          margin: '6px 0',
        }}
      />

      {appIds.map((id, i) => {
        const app = COMMON_APPS.find((a) => a.id === id);
        const label = app?.name ?? id;
        const icon = app?.icon ?? '📦';
        return (
          <Tooltip key={`${id}-${i}`} label={label} side="right">
            <button
              onClick={() => launchApp(id)}
              onContextMenu={(e) => onContextMenu(e, i)}
              aria-label={`Launch ${label}`}
              data-testid={`toolbox-app-${id}`}
              style={{
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
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2a2a2a';
                e.currentTarget.style.borderColor = '#3a3a3a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              {icon}
            </button>
          </Tooltip>
        );
      })}

      {appIds.length === 0 && (
        <Tooltip label="Right-click to add an app" side="right">
          <button
            onClick={restoreDefaults}
            aria-label="Restore default apps"
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              backgroundColor: 'transparent',
              border: '1px dashed #3a3a3a',
              color: '#666',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitAppRegion: 'no-drag',
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
            minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.index >= 0 && (
            <MenuItem
              label="Remove from sidebar"
              onClick={() => {
                removeApp(menu.index);
                setMenu(null);
              }}
            />
          )}
          <MenuItem label="Add custom app…" onClick={() => { setMenu(null); addCustom(); }} />
          <MenuItem label="Restore defaults" onClick={() => { setMenu(null); restoreDefaults(); }} />
        </div>
      )}
    </div>
  );
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
