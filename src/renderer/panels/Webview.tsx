import React from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

export const WebviewPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'webview' ? panel.content.ref : null;
  const url = ref?.url ?? '';
  const html = ref?.html;

  if (html) {
    return (
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        title={panel.title}
      />
    );
  }

  if (!url) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12 }}>
        Webview panel — set a URL via the panel properties.
      </div>
    );
  }

  return (
    <iframe
      src={url}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      title={panel.title}
    />
  );
};
