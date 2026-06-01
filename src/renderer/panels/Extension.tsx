import React, { useEffect, useState } from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

export const ExtensionPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'extension' ? panel.content.ref : null;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref?.extensionId || !ref?.viewId) {
      setError('Extension panel is missing extensionId or viewId.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Wire to extension host via main process IPC
        const result = (await (window as any).canvasAPI?.getExtensionWebview?.(
          ref.extensionId,
          ref.viewId
        )) as string | null | undefined;
        if (cancelled) return;
        if (result) setHtml(result);
        else
          setError(
            `Extension "${ref.extensionId}" returned no webview content. Ensure the extension is installed and the view is registered.`
          );
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref?.extensionId, ref?.viewId]);

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: '#cc6666',
          fontSize: 12,
          fontFamily: 'monospace',
          background: '#1a1a1a',
          height: '100%',
        }}
      >
        {error}
      </div>
    );
  }

  if (!html) {
    return (
      <div
        style={{
          padding: 16,
          color: '#888',
          fontSize: 12,
          background: '#1a1a1a',
          height: '100%',
        }}
      >
        Loading extension webview...
      </div>
    );
  }

  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin allow-forms"
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      title={panel.title}
      onLoad={(e) => {
        const iframe = e.currentTarget;
        try {
          iframe.contentWindow?.postMessage(
            { type: 'canvas:webview:ready', viewId: ref?.viewId },
            '*'
          );
        } catch {
          // ignore cross-origin
        }
      }}
    />
  );
};
