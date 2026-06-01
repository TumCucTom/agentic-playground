import { Panel, PanelType, ContentRef } from '../../shared/types';

function uuid(): string {
  return 'p_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

const DEFAULT_SIZE = { width: 500, height: 360 };

// The renderer has no `process` global; default to the user's home
// directory. The file explorer can navigate from there.
const DEFAULT_ROOT_PATH = '~';

const FACTORIES: Record<
  PanelType,
  (x: number, y: number) => { title: string; content: ContentRef }
> = {
  terminal: (x, y) => ({
    title: 'Terminal',
    content: {
      type: 'terminal',
      ref: {
        shell: '/bin/zsh',
        cwd: DEFAULT_ROOT_PATH,
        cols: 80,
        rows: 24,
      },
    },
  }),
  editor: (x, y) => ({
    title: 'Editor',
    content: { type: 'editor', ref: { filePath: null, language: 'plaintext' } },
  }),
  fileExplorer: (x, y) => ({
    title: 'Files',
    content: { type: 'fileExplorer', ref: { rootPath: DEFAULT_ROOT_PATH } },
  }),
  webview: (x, y) => ({
    title: 'Web',
    content: { type: 'webview', ref: { url: 'https://example.com' } },
  }),
  markdownPreview: (x, y) => ({
    title: 'Markdown',
    content: { type: 'markdownPreview', ref: { filePath: '' } },
  }),
  extension: (x, y) => ({
    title: 'Extension',
    content: {
      type: 'extension',
      ref: { extensionId: '', viewId: '', webviewId: '' },
    },
  }),
  embedded: (x, y) => ({
    title: 'App Launcher',
    content: { type: 'embedded', ref: { appBundleId: '' } },
  }),
};

export function createPanelOfType(type: PanelType, canvasX: number, canvasY: number): Panel {
  const factory = FACTORIES[type];
  if (!factory) {
    throw new Error(`Unknown panel type: ${type}`);
  }
  const { title, content } = factory(canvasX, canvasY);
  return {
    id: uuid(),
    type,
    position: {
      x: canvasX - DEFAULT_SIZE.width / 2,
      y: canvasY - DEFAULT_SIZE.height / 2,
    },
    size: { ...DEFAULT_SIZE },
    title,
    state: 'idle',
    zOrder: 0,
    content,
  };
}
