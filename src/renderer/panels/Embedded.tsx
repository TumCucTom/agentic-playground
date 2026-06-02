import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Panel } from '../../shared/types';
import { useCanvasStore } from '../state/canvasStore';
import { SIDEBAR_WIDTH, TITLE_BAR_HEIGHT } from '../layout/canvasChrome';
import { COMMON_APPS, nameToAppId } from '../commonApps';
import { WEB_APPS, WebApp } from '../webApps';
import { createPanelOfType } from './factory';

interface Props {
  panel: Panel;
}

interface Source {
  id: string;
  name: string;
  appIcon: string | null;
  thumbnail: string | null;
  pid?: number | null;
}

export const EmbeddedPanel: React.FC<Props> = ({ panel }) => {
  const viewport = useCanvasStore((s) => s.viewport);
  const addPanel = useCanvasStore((s) => s.addPanel);
  const focusPanel = useCanvasStore((s) => s.focusPanel);

  // Center of the visible canvas content area (under the chrome), in
  // world coordinates. New panels created from this launcher land here
  // so the user sees them appear front-and-center.
  const canvasCenter = useMemo(() => {
    const visibleW = window.innerWidth - SIDEBAR_WIDTH;
    const visibleH = window.innerHeight - TITLE_BAR_HEIGHT;
    return {
      x: viewport.x + visibleW / 2 / viewport.zoom,
      y: viewport.y + visibleH / 2 / viewport.zoom,
    };
  }, [viewport]);

  const openWebApp = useCallback(
    (app: WebApp) => {
      const newPanel = createPanelOfType('webview', canvasCenter.x, canvasCenter.y, {
        url: app.url,
      });
      newPanel.title = app.name;
      addPanel(newPanel);
      focusPanel(newPanel.id);
    },
    [canvasCenter, addPanel, focusPanel]
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0f0f0f',
        overflowY: 'auto',
        color: '#d0d0d0',
        fontSize: 12,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '20px 18px 14px',
          textAlign: 'center',
          borderBottom: '1px solid #1f1f1f',
        }}
      >
        <div style={{ fontWeight: 500, fontSize: 15, color: '#e0e0e0' }}>App Launcher</div>
        <div
          style={{
            color: '#888',
            lineHeight: 1.45,
            maxWidth: 380,
            margin: '6px auto 0',
            fontSize: 11,
          }}
        >
          Pick a web app to open it as a panel. Each panel gets its own
          session, so two Notion tabs can be two different accounts.
        </div>
      </div>

      <div
        data-testid="embedded-web-apps"
        style={{
          padding: '14px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {WEB_APPS.map((app) => (
          <button
            key={app.id}
            onClick={() => openWebApp(app)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '14px 6px',
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#d0d0d0',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#222';
              e.currentTarget.style.borderColor = '#3a3a3a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#2a2a2a';
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1 }}>{app.icon}</div>
            <div style={{ fontSize: 11, fontWeight: 500, textAlign: 'center' }}>{app.name}</div>
          </button>
        ))}
      </div>

      <details
        data-testid="embedded-mirror-details"
        style={{
          margin: '4px 12px 16px',
          background: '#141414',
          border: '1px solid #1f1f1f',
          borderRadius: 6,
        }}
      >
        <summary
          style={{
            padding: '10px 12px',
            cursor: 'pointer',
            fontSize: 11,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            userSelect: 'none',
          }}
        >
          Mirror native app (advanced)
        </summary>
        <div style={{ padding: '0 12px 12px' }}>
          <MirrorSection panel={panel} />
        </div>
      </details>
    </div>
  );
};

// MirrorSection: preserved from the pre-pivot App Launcher. Streams an
// existing macOS window into the panel via desktopCapturer + getUserMedia.
// Requires both Screen Recording AND Accessibility permissions. Kept
// verbatim so users with native-only apps can still mirror them; new
// users should use the web app grid above.
const MirrorSection: React.FC<Props> = ({ panel }) => {
  const updatePanel = useCanvasStore((s) => s.updatePanel);
  const viewport = useCanvasStore((s) => s.viewport);
  const layoutMode = useCanvasStore((s) => s.layoutMode);
  const initialAppBundleId =
    panel.content.type === 'embedded' ? panel.content.ref.appBundleId : '';

  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [lastMirror, setLastMirror] = useState<string | null>(null);

  // macOS Screen Recording grant status. 'unknown' until we ask, then
  // 'granted' / 'denied' / 'restricted'. When denied, the mirror flow
  // silently fails because desktopCapturer.getSources returns an empty
  // array and getUserMedia with chromeMediaSource fails — we surface
  // this with a banner so the user knows what to grant.
  const [screenAccess, setScreenAccess] = useState<
    'unknown' | 'granted' | 'denied' | 'restricted' | 'not-determined'
  >('unknown');

  const checkScreenAccess = useCallback(async () => {
    try {
      const r = await window.canvasAPI.checkMediaAccess('screen');
      if (r.ok && r.status) setScreenAccess(r.status as typeof screenAccess);
    } catch {
      // ignore — fall back to 'unknown'
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
  }, []);

  const attachStream = useCallback(
    (stream: MediaStream, sourceLabel: string) => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {
          // Autoplay may be blocked; user can click play
        });
      }
      setLastMirror(sourceLabel);
      setStreaming(true);
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        stopStream();
      });
    },
    [stopStream]
  );

  const captureBySourceId = useCallback(
    async (sourceId: string, sourceName: string) => {
      setError(null);
      try {
        const stream = await (navigator.mediaDevices as any).getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
        });
        attachStream(stream, sourceName);
      } catch (err) {
        setError((err as Error).message);
        setStreaming(false);
        // getUserMedia may fail because Screen Recording hasn't been
        // granted yet — re-probe so the permission banner shows up.
        void checkScreenAccess();
      }
    },
    [attachStream, checkScreenAccess]
  );

  const startPicker = useCallback(async () => {
    setError(null);
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      attachStream(stream, track?.label || 'picked window');
    } catch (err) {
      setError((err as Error).message);
      setStreaming(false);
    }
  }, [attachStream]);

  const refreshSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const list = await window.canvasAPI.listDesktopSources();
      setSources(list);
    } catch {
      // Non-fatal — quick-pick just won't show.
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
    void checkScreenAccess();
  }, [refreshSources, checkScreenAccess]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  // Group sources by app id; filter to one window per app by default.
  const groupedByApp = useMemo(() => {
    const groups = new Map<string, Source[]>();
    for (const s of sources) {
      const id = nameToAppId(s.name);
      if (id === 'com.electron.canvas-workspace') continue;
      if (s.name === 'Window Server' || s.name === 'ScreenCaptureService') continue;
      const key = id || s.name;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .map(([key, wins]) => {
        const app = COMMON_APPS.find((a) => a.id === key);
        return {
          key,
          id: key,
          name: app?.name ?? wins[0].name,
          icon: app?.icon ?? '🪟',
          windows: wins,
        };
      })
      .sort((a, b) => {
        const ai = COMMON_APPS.findIndex((c) => c.id === a.id);
        const bi = COMMON_APPS.findIndex((c) => c.id === b.id);
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }, [sources]);

  return (
    <div>
      {screenAccess === 'denied' && (
        <div
          data-testid="embedded-screen-permission"
          style={{
            margin: '10px 0',
            padding: 10,
            background: 'rgba(120, 40, 40, 0.4)',
            border: '1px solid #8a3a3a',
            borderRadius: 6,
            color: '#ffd0d0',
            fontSize: 11,
            lineHeight: 1.45,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 500 }}>Screen Recording permission required</div>
          <div>
            macOS blocks <code>desktopCapturer</code> until Canvas Workspace
            is granted Screen Recording. The mirror flow needs it.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => void window.canvasAPI.openSystemSettings('screenRecording')}
              style={{
                background: 'rgba(255, 255, 255, 0.12)',
                border: 'none',
                color: '#ffd0d0',
                cursor: 'pointer',
                padding: '4px 10px',
                fontSize: 11,
                borderRadius: 3,
                fontFamily: 'inherit',
              }}
            >
              Open Settings
            </button>
            <button
              onClick={() => void checkScreenAccess()}
              style={{
                background: 'transparent',
                border: '1px solid #8a3a3a',
                color: '#ffd0d0',
                cursor: 'pointer',
                padding: '4px 10px',
                fontSize: 11,
                borderRadius: 3,
                fontFamily: 'inherit',
              }}
            >
              Re-check
            </button>
          </div>
        </div>
      )}

      {streaming ? (
        <div
          style={{
            position: 'relative',
            background: '#000',
            borderRadius: 4,
            overflow: 'hidden',
            minHeight: 200,
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxHeight: 280,
              objectFit: 'contain',
              background: '#000',
              display: 'block',
            }}
          />
          <div
            data-testid="embedded-live"
            style={{
              position: 'absolute',
              top: 6,
              right: 8,
              padding: '3px 8px',
              background: 'rgba(90, 159, 212, 0.2)',
              color: '#5a9fd4',
              fontSize: 10,
              borderRadius: 3,
              fontFamily: 'monospace',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={lastMirror || ''}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: '#5a9fd4',
                borderRadius: '50%',
                display: 'inline-block',
                marginRight: 6,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            live{lastMirror ? ` · ${lastMirror}` : ''}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '8px 0',
            }}
          >
            <div
              style={{
                color: '#888',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Pick a window
            </div>
            <button
              onClick={refreshSources}
              disabled={sourcesLoading}
              style={{
                background: 'transparent',
                border: '1px solid #3a3a3a',
                color: '#888',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 3,
                cursor: sourcesLoading ? 'default' : 'pointer',
                opacity: sourcesLoading ? 0.5 : 1,
              }}
            >
              {sourcesLoading ? '…' : '↻ refresh'}
            </button>
          </div>
          {sourcesLoading && sources.length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>Scanning windows…</div>
          ) : groupedByApp.length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>
              No other windows open. Open something then refresh.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 6,
              }}
            >
              {groupedByApp.map((g) => (
                <button
                  key={g.key}
                  onClick={() => captureBySourceId(g.windows[0].id, g.name)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 4px',
                    background: '#1f1f1f',
                    border: '1px solid #2a2a2a',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: '#d0d0d0',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#262626';
                    e.currentTarget.style.borderColor = '#3a3a3a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#1f1f1f';
                    e.currentTarget.style.borderColor = '#2a2a2a';
                  }}
                >
                  {g.windows[0].appIcon ? (
                    <img
                      src={g.windows[0].appIcon}
                      alt=""
                      style={{ width: 24, height: 24, borderRadius: 4 }}
                    />
                  ) : (
                    <div style={{ fontSize: 20 }}>{g.icon}</div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 500, textAlign: 'center' }}>
                    {g.name}
                  </div>
                  {g.windows.length > 1 && (
                    <div style={{ fontSize: 9, color: '#666' }}>+{g.windows.length - 1} more</div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div style={{ textAlign: 'center', margin: '12px 0 4px' }}>
            <button
              onClick={startPicker}
              data-testid="embedded-pick"
              style={{
                padding: '6px 12px',
                background: '#2a2a2a',
                color: '#d0d0d0',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Pick another window…
            </button>
          </div>
        </>
      )}

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: 6,
            background: '#5a1f1f',
            color: '#ff8888',
            borderRadius: 3,
            fontSize: 10,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};
