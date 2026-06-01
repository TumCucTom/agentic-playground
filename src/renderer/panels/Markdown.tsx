import React, { useEffect, useState } from 'react';
import { Panel } from '../../shared/types';

interface Props {
  panel: Panel;
}

const SAMPLE = `# Canvas Workspace

This is a **markdown preview panel**. Live editing is wired through the
main process in a follow-up task — for now it shows sample content.

## Features

- Infinite zoomable canvas
- VS Code extension panels
- Real terminal, file explorer, editor panels
- Persistent workspaces

## Code

\`\`\`javascript
function hello() {
  return 'world';
}
\`\`\`

> Quote blocks work too.
`;

export const MarkdownPreviewPanel: React.FC<Props> = ({ panel }) => {
  const ref = panel.content.type === 'markdownPreview' ? panel.content.ref : null;
  const [content, setContent] = useState<string>(SAMPLE);

  useEffect(() => {
    if (!ref?.filePath) {
      setContent(SAMPLE);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = (await (window as any).canvasAPI?.readFile?.(ref.filePath)) as
          | string
          | null
          | undefined;
        if (cancelled) return;
        if (result) setContent(result);
        else setContent(SAMPLE);
      } catch (err) {
        setContent(`Error: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref?.filePath]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: '#ffffff',
        color: '#1a1a1a',
        padding: 24,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      <SimpleMarkdown content={content} />
    </div>
  );
};

// Minimal markdown renderer — handles the basics.
const SimpleMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const blocks = content.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.startsWith('# ')) return <h1 key={i}>{block.slice(2)}</h1>;
        if (block.startsWith('## ')) return <h2 key={i}>{block.slice(3)}</h2>;
        if (block.startsWith('### ')) return <h3 key={i}>{block.slice(4)}</h3>;
        if (block.startsWith('> '))
          return (
            <blockquote
              key={i}
              style={{ borderLeft: '3px solid #ccc', paddingLeft: 12, color: '#555' }}
            >
              {block.slice(2)}
            </blockquote>
          );
        if (block.startsWith('```')) {
          const lines = block.split('\n').slice(1, -1);
          return (
            <pre
              key={i}
              style={{
                background: '#f4f4f4',
                padding: 12,
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 13,
                overflow: 'auto',
              }}
            >
              {lines.join('\n')}
            </pre>
          );
        }
        if (block.match(/^[-*] /m)) {
          const items = block.split('\n').map((l) => l.replace(/^[-*] /, ''));
          return (
            <ul key={i}>
              {items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </>
  );
};
