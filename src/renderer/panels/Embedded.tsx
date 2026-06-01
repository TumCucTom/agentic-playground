import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Panel } from '../../shared/types';
import { useCanvasStore } from '../state/canvasStore';
import { rectsFromTree } from '../layout/splitTree';
import { SIDEBAR_WIDTH, TITLE_BAR_HEIGHT } from '../layout/canvasChrome';
import { COMMON_APPS, nameToAppId } from '../commonApps';

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

const STORAGE_KEY = 'canvas-embedded-prefs';
const FRAME_RATES = [15, 24, 30, 60];

interface Prefs {
  appBundleId: string;
  frameRate: number;
  // When true (default), after a successful launch we ask the main
  // process to position the spawned app's window inside the Electron
  // window so it visually lives "in the canvas" — the screen-mirror
  // stream is layered on top. Off by default because it requires
  // Accessibility permission and may not work for all apps.
  reparent: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        appBundleId: '',
        frameRate: 30,
        reparent: true,
        ...parsed,
      };
    }
  } catch {
    // ignore
  }
  return { appBundleId: '', frameRate: 30, reparent: true };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

// Friendly mapping of common macOS bundle IDs to a display name & emoji.
// These double as the "Quick Launch" buttons: clicking one spawns a new
// instance of the app and streams its window into this panel.
// (See ../commonApps.ts for the shared list.)


export const EmbeddedPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'embedded' ? panel.content.ref : null;
  const updatePanel = useCanvasStore((s) => s.updatePanel);
  const viewport = useCanvasStore((s) => s.viewport);
  const layoutMode = useCanvasStore((s) => s.layoutMode);
  const initialAppBundleId = ref?.appBundleId ?? '';

  // Compute the panel's screen rect so the reparent helper can position
  // the spawned app's window on top of where the user already sees the
  // stream. Returns null if the panel isn't currently laid out (e.g.,
  // the grid tree has no entry for it yet).
  const getPanelScreenRect = (): { x: number; y: number; width: number; height: number } | null => {
    const winScreenX = window.screenX ?? 0;
    const winScreenY = window.screenY ?? 0;
    // The grid layout sits inside the canvas chrome (sidebar +
    // title bar). rectsFromTree uses local coordinates from the
    // layout's origin, which is (SIDEBAR_WIDTH, TITLE_BAR_HEIGHT) in
    // window coordinates.
    if (layoutMode === 'grid') {
      const tree = useCanvasStore.getState().gridTree;
      if (!tree) return null;
      const rects = rectsFromTree(tree, {
        x: 0,
        y: 0,
        w: window.innerWidth - SIDEBAR_WIDTH,
        h: window.innerHeight - TITLE_BAR_HEIGHT,
      });
      const r = rects.get(panel.id);
      if (!r) return null;
      return {
        x: winScreenX + SIDEBAR_WIDTH + r.x,
        y: winScreenY + TITLE_BAR_HEIGHT + r.y,
        width: r.w,
        height: r.h,
      };
    }
    const z = viewport.zoom;
    return {
      x: winScreenX + SIDEBAR_WIDTH + (panel.position.x - viewport.x) * z,
      y: winScreenY + TITLE_BAR_HEIGHT + (panel.position.y - viewport.y) * z,
      width: panel.size.width * z,
      height: panel.size.height * z,
    };
  };
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const stored = loadPrefs();
    return { ...stored, appBundleId: initialAppBundleId || stored.appBundleId };
  });
  const [showSettings, setShowSettings] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const launchedPidRef = useRef<number | null>(null);
  const launchedBundleIdRef = useRef<string | null>(null);
  const launchedAppNameRef = useRef<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reparentError, setReparentError] = useState<string | null>(null);
  const [lastMirror, setLastMirror] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    return () => {
      stopStream();
      // Kill the macOS app we launched (if any) so we don't leave
      // orphan instances after the panel closes.
      const pid = launchedPidRef.current;
      if (pid) {
        void window.canvasAPI.killApp(pid);
        launchedPidRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // On mount, if the panel has a persisted bundleId, auto-launch a new
  // instance — mirrors how the terminal panel auto-spawns a shell.
  useEffect(() => {
    const bundleId = ref?.appBundleId;
    if (bundleId && !launchedPidRef.current) {
      void launchNewInstance(bundleId, false);
    }
    // We intentionally only re-run if the bundleId changes between
    // mounts. Manual launches go through the callback below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
  }, []);

  const attachStream = useCallback((stream: MediaStream, sourceLabel: string) => {
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
  }, [stopStream]);

  // Stream a specific desktopCapturer source by its id. The main process
  // registered setDisplayMediaRequestHandler which returns a stream for
  // the first window. To target a specific source we issue a new
  // getUserMedia call using chromeMediaSourceId.
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
              maxFrameRate: prefs.frameRate,
            },
          },
        });
        attachStream(stream, sourceName);
      } catch (err) {
        setError((err as Error).message);
        setStreaming(false);
      }
    },
    [attachStream, prefs.frameRate]
  );

  const startPicker = useCallback(async () => {
    setError(null);
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: prefs.frameRate },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      attachStream(stream, track?.label || 'picked window');
    } catch (err) {
      setError((err as Error).message);
      setStreaming(false);
    }
  }, [attachStream, prefs.frameRate]);

  // Launch a new instance of the app and start streaming its window.
  // Persists the bundleId in panel state so the choice survives reloads,
  // and tracks the spawned pid so we can kill the instance on unmount.
  const launchNewInstance = useCallback(
    async (bundleId: string, persistToPanel: boolean) => {
      if (launching) return;
      setError(null);
      setLaunching(true);
      stopStream();
      // Kill any prior instance from this panel first.
      if (launchedPidRef.current) {
        try {
          await window.canvasAPI.killApp(launchedPidRef.current);
        } catch {
          // ignore — may already be gone
        }
        launchedPidRef.current = null;
      }

      try {
        const result = await window.canvasAPI.launchApp(bundleId);
        if (!result.ok || !result.pid) {
          setError(result.error || 'Launch failed');
          return;
        }
        launchedPidRef.current = result.pid;
        launchedBundleIdRef.current = bundleId;
        launchedAppNameRef.current = result.appName || bundleId;

        if (persistToPanel && panel.content.type === 'embedded') {
          updatePanel(panel.id, {
            content: { type: 'embedded', ref: { appBundleId: bundleId } },
          });
        }

        // Best-effort: position the spawned app's window inside the
        // Electron window so it visually lives "in the canvas". The
        // native helper may fail (Accessibility permission, the app
        // may refuse to be moved, etc.) — we surface the failure as a
        // soft warning so the user knows to check Accessibility.
        if (prefs.reparent) {
          try {
            const target = getPanelScreenRect();
            if (target) {
              const r = await window.canvasAPI.reparentApp(bundleId, target);
              if (!r.ok) {
                setReparentError(`Reparent failed: ${r.error || 'unknown'}`);
              } else {
                setReparentError(null);
              }
            }
          } catch (err) {
            setReparentError(`Reparent failed: ${(err as Error).message}`);
          }
        }

        // Poll desktopCapturer until the new window shows up. Apps take
        // 100-1500ms to register a window after launch.
        const deadline = Date.now() + 6000;
        let found: Source | null = null;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 350));
          try {
            const list = await window.canvasAPI.listDesktopSources();
            setSources(list);
            found = list.find((s) => s.pid === result.pid) || null;
            if (found) break;
          } catch {
            // ignore — keep polling
          }
        }
        if (!found) {
          setError(
            `Launched ${result.appName} (pid ${result.pid}) but no window appeared. The app may have launched in the background.`
          );
          return;
        }
        await captureBySourceId(found.id, result.appName || found.name);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLaunching(false);
      }
    },
    [launching, stopStream, captureBySourceId, updatePanel, panel.id, panel.content.type]
  );

  const stopLaunched = useCallback(async () => {
    stopStream();
    if (launchedPidRef.current) {
      try {
        await window.canvasAPI.killApp(launchedPidRef.current);
      } catch {
        // ignore
      }
      launchedPidRef.current = null;
    }
  }, [stopStream]);

  // Re-mirror: stop the current stream and re-launch the same app.
  const relaunch = useCallback(() => {
    const bundleId = launchedBundleIdRef.current || prefs.appBundleId;
    if (bundleId) void launchNewInstance(bundleId, false);
  }, [launchNewInstance, prefs.appBundleId]);

  // Re-position the spawned window so it sits over this panel. Useful
  // when the user has dragged the panel after the initial launch.
  const snapToPanel = useCallback(async () => {
    const bundleId = launchedBundleIdRef.current;
    if (!bundleId) return;
    const target = getPanelScreenRect();
    if (!target) return;
    setReparentError(null);
    try {
      const result = await window.canvasAPI.reparentApp(bundleId, target);
      if (!result.ok) {
        setReparentError(result.error || 'Snap failed');
      }
    } catch (err) {
      setReparentError((err as Error).message);
    }
  }, [getPanelScreenRect]);

  // Load the running-windows list from the main process on mount.
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
  }, [refreshSources]);

  // Group sources by app id; filter to one window per app by default to
  // keep the sidebar tidy, but show "more windows" count.
  const groupedByApp = (() => {
    const groups = new Map<string, Source[]>();
    for (const s of sources) {
      const id = nameToAppId(s.name);
      // Skip our own window + helper entries.
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
  })();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#000',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {streaming ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            overflowY: 'auto',
            padding: 16,
            color: '#d0d0d0',
            fontSize: 12,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 24, color: '#d0d0d0' }}>▶</div>
            <div style={{ fontWeight: 500, fontSize: 14, margin: '4px 0' }}>App Launcher</div>
            <div style={{ color: '#888', lineHeight: 1.4, maxWidth: 360, margin: '0 auto' }}>
              Pick an app to launch a new instance. The window streams in
              here; closing the panel kills the spawned process. Use
              "Mirror existing" to capture a window that's already open.
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
            }}
          >
            <div
              style={{
                color: '#888',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Quick launch — new instance
            </div>
            {launching && (
              <div style={{ color: '#5a9fd4', fontSize: 11, marginBottom: 8 }}>
                Launching…
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 6,
              }}
            >
              {COMMON_APPS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => launchNewInstance(a.id, true)}
                  disabled={launching}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '10px 6px',
                    background: '#252525',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    cursor: launching ? 'default' : 'pointer',
                    color: '#d0d0d0',
                    fontFamily: 'inherit',
                    opacity: launching ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (launching) return;
                    e.currentTarget.style.background = '#2f2f2f';
                    e.currentTarget.style.borderColor = '#3a3a3a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#252525';
                    e.currentTarget.style.borderColor = '#2a2a2a';
                  }}
                >
                  <div style={{ fontSize: 24 }}>{a.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 500, textAlign: 'center' }}>
                    {a.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Mirror existing
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
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
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
                      padding: '10px 6px',
                      background: '#252525',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: '#d0d0d0',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#2f2f2f';
                      e.currentTarget.style.borderColor = '#3a3a3a';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#252525';
                      e.currentTarget.style.borderColor = '#2a2a2a';
                    }}
                  >
                    {g.windows[0].appIcon ? (
                      <img
                        src={g.windows[0].appIcon}
                        alt=""
                        style={{ width: 32, height: 32, borderRadius: 6 }}
                      />
                    ) : (
                      <div style={{ fontSize: 24 }}>{g.icon}</div>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 500, textAlign: 'center' }}>
                      {g.name}
                    </div>
                    {g.windows.length > 1 && (
                      <div style={{ fontSize: 9, color: '#666' }}>
                        +{g.windows.length - 1} more
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', margin: '14px 0 8px' }}>
            <button
              onClick={startPicker}
              data-testid="embedded-pick"
              style={{
                padding: '8px 16px',
                background: '#5a9fd4',
                color: '#1a1a1a',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Pick another window…
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => setShowSettings((s) => !s)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                fontSize: 11,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {showSettings ? 'hide settings' : 'settings'}
            </button>
          </div>

          {showSettings && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                textAlign: 'left',
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#888', marginBottom: 4, fontSize: 10 }}>Target bundle id</div>
                <input
                  value={prefs.appBundleId}
                  onChange={(e) => setPrefs((p) => ({ ...p, appBundleId: e.target.value }))}
                  placeholder="e.g. com.google.Chrome"
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    background: '#0e0e0e',
                    color: '#d0d0d0',
                    border: '1px solid #3a3a3a',
                    borderRadius: 3,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {COMMON_APPS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setPrefs((p) => ({ ...p, appBundleId: a.id }))}
                      style={{
                        padding: '2px 6px',
                        background: prefs.appBundleId === a.id ? '#3a3a3a' : '#252525',
                        color: '#d0d0d0',
                        border: '1px solid #2a2a2a',
                        borderRadius: 3,
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: 4, fontSize: 10 }}>Frame rate</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {FRAME_RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setPrefs((p) => ({ ...p, frameRate: r }))}
                      style={{
                        flex: 1,
                        padding: '4px 0',
                        background: prefs.frameRate === r ? '#5a9fd4' : '#252525',
                        color: prefs.frameRate === r ? '#1a1a1a' : '#d0d0d0',
                        border: '1px solid #2a2a2a',
                        borderRadius: 3,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#d0d0d0',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={prefs.reparent}
                    onChange={(e) => setPrefs((p) => ({ ...p, reparent: e.target.checked }))}
                  />
                  Position window inside canvas (reparent)
                </label>
                <div style={{ color: '#666', fontSize: 10, marginTop: 4, marginLeft: 20 }}>
                  Requires Accessibility permission for Terminal.
                </div>
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: '#5a1f1f',
                color: '#ff8888',
                borderRadius: 3,
                fontSize: 11,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {streaming && (
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
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 280,
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
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          live · {prefs.frameRate}fps{lastMirror ? ` · ${lastMirror}` : ''}
        </div>
      )}

      {reparentError && (
        <div
          data-testid="embedded-reparent-error"
          style={{
            position: 'absolute',
            top: 6,
            left: 8,
            right: 8,
            padding: '4px 8px',
            background: 'rgba(120, 40, 40, 0.85)',
            color: '#ffd0d0',
            fontSize: 10,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {reparentError}
          </span>
          <button
            onClick={() => setReparentError(null)}
            aria-label="Dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffd0d0',
              cursor: 'pointer',
              padding: 0,
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {streaming && (
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            display: 'flex',
            gap: 4,
          }}
        >
          <button
            onClick={relaunch}
            title="Re-launch"
            style={{
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: 3,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            ↻ relaunch
          </button>
          <button
            onClick={snapToPanel}
            title="Snap window to this panel"
            style={{
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: 3,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            ⤴ snap
          </button>
          <button
            onClick={stopLaunched}
            style={{
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: '#d0d0d0',
              border: '1px solid #3a3a3a',
              borderRadius: 3,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            stop
          </button>
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
