import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

export const EmbeddedPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'embedded' ? panel.content.ref : null;
  const appBundleId = ref?.appBundleId ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionAsked, setPermissionAsked] = useState(false);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
  };

  const startCapture = async () => {
    setError(null);
    setPermissionAsked(true);
    try {
      // Use the standard getDisplayMedia API. macOS will show a picker
      // letting the user choose which window to share.
      // Note: this is a one-way screen mirror, not true window
      // reparenting. Input forwarding is not supported.
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: {
          // frameRate: 30, // omitted: Chromium may refuse if display has different rate
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
      setStreaming(true);
      // Stop tracks when user clicks the browser's "Stop sharing" button
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopStream();
      });
    } catch (err) {
      setError((err as Error).message);
      setStreaming(false);
    }
  };

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
            maxWidth: 320,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8, color: '#d0d0d0' }}>🪞</div>
          <div style={{ fontWeight: 500, color: '#d0d0d0', marginBottom: 6 }}>
            App Mirror
          </div>
          <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
            Capture a window from another app and display it inside this panel.
            The stream is a one-way mirror — interact with the real app window
            directly.
          </div>
          {appBundleId && (
            <div style={{ marginBottom: 12, color: '#666', fontFamily: 'monospace' }}>
              target: {appBundleId}
            </div>
          )}
          <button
            onClick={startCapture}
            style={{
              padding: '8px 14px',
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
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            padding: '2px 6px',
            background: 'rgba(90, 159, 212, 0.2)',
            color: '#5a9fd4',
            fontSize: 10,
            borderRadius: 3,
            fontFamily: 'monospace',
          }}
        >
          ● live mirror
        </div>
      )}
      {streaming && (
        <button
          onClick={stopStream}
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
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
      )}
    </div>
  );
};
