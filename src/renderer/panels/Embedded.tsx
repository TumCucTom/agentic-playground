import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

const COMMON_APPS = [
  { id: 'com.google.Chrome', name: 'Google Chrome' },
  { id: 'com.microsoft.VSCode', name: 'Visual Studio Code' },
  { id: 'com.apple.Terminal', name: 'Terminal' },
  { id: 'com.apple.Safari', name: 'Safari' },
  { id: 'com.figma.Desktop', name: 'Figma' },
  { id: 'com.spotify.client', name: 'Spotify' },
  { id: 'com.apple.finder', name: 'Finder' },
];

const STORAGE_KEY = 'canvas-embedded-prefs';
const FRAME_RATES = [15, 24, 30, 60];

interface Prefs {
  appBundleId: string;
  frameRate: number;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { appBundleId: '', frameRate: 30 };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export const EmbeddedPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'embedded' ? panel.content.ref : null;
  const initialAppBundleId = ref?.appBundleId ?? '';
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const stored = loadPrefs();
    return { ...stored, appBundleId: initialAppBundleId || stored.appBundleId };
  });
  const [showSettings, setShowSettings] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMirror, setLastMirror] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: {
          frameRate: prefs.frameRate,
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {
          // Autoplay may be blocked; user can click play
        });
      }
      // Try to detect which app is being shared
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings?.() || {};
      const displaySurface = (settings as any).displaySurface;
      const label = track.label || 'unknown window';
      setLastMirror(`${label}${displaySurface ? ` (${displaySurface})` : ''}`);

      setStreaming(true);
      track.addEventListener('ended', () => {
        stopStream();
      });
    } catch (err) {
      setError((err as Error).message);
      setStreaming(false);
    }
  }, [prefs.frameRate, stopStream]);

  const reMirror = useCallback(() => {
    stopStream();
    setTimeout(() => startCapture(), 100);
  }, [stopStream, startCapture]);

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
            padding: 24,
            textAlign: 'center',
            color: '#888',
            fontSize: 12,
            maxWidth: 360,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, color: '#d0d0d0' }}>🪞</div>
          <div style={{ fontWeight: 500, color: '#d0d0d0', marginBottom: 6, fontSize: 14 }}>
            App Mirror
          </div>
          <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
            Capture a window from another app and display it inside this panel.
            The stream is a one-way mirror — interact with the real app window directly.
          </div>

          <button
            onClick={startCapture}
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
            Pick a window…
          </button>

          <div style={{ marginTop: 14 }}>
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
                borderRadius: 4,
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
            onClick={reMirror}
            title="Re-mirror"
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
            ↻ re-mirror
          </button>
          <button
            onClick={stopStream}
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
