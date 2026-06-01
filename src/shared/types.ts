// Shared types between main, renderer, and extension host

export type PanelType =
  | 'terminal'
  | 'fileExplorer'
  | 'editor'
  | 'webview'
  | 'markdownPreview'
  | 'extension'
  | 'embedded';

export type PanelState = 'idle' | 'running';

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface ExtensionContentRef {
  extensionId: string;
  viewId: string;
  webviewId: string;
}

export interface WebviewContentRef {
  url: string;
  html?: string;
}

export interface TerminalContentRef {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface FileExplorerContentRef {
  rootPath: string;
}

export interface EditorContentRef {
  filePath: string | null;
  language: string;
}

export interface MarkdownContentRef {
  filePath: string;
}

export type ContentRef =
  | { type: 'terminal'; ref: TerminalContentRef }
  | { type: 'fileExplorer'; ref: FileExplorerContentRef }
  | { type: 'editor'; ref: EditorContentRef }
  | { type: 'webview'; ref: WebviewContentRef }
  | { type: 'markdownPreview'; ref: MarkdownContentRef }
  | { type: 'extension'; ref: ExtensionContentRef }
  | { type: 'embedded'; ref: { appBundleId: string } };

export interface Panel {
  id: string;
  type: PanelType;
  position: PanelPosition;
  size: PanelSize;
  title: string;
  state: PanelState;
  zOrder: number;
  content: ContentRef;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type LayoutMode = 'canvas' | 'grid';

export type SplitTree =
  | { kind: 'leaf'; panelId: string }
  | {
      kind: 'split';
      dir: 'h' | 'v';
      ratio: number;
      a: SplitTree;
      b: SplitTree;
    };

export interface CanvasState {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
  workspaceName: string;
  lastUpdated: number;
  layoutMode: LayoutMode;
  gridTree?: SplitTree;
}

export interface Workspace {
  name: string;
  state: CanvasState;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  main: string;
  contributes?: ExtensionContributes;
}

export interface ExtensionContributes {
  webviews?: WebviewContribution[];
  commands?: CommandContribution[];
  views?: ViewContribution[];
}

export interface WebviewContribution {
  id: string;
  title: string;
  icon?: string;
}

export interface CommandContribution {
  command: string;
  title: string;
  category?: string;
}

export interface ViewContribution {
  id: string;
  name: string;
}

export interface IpcChannels {
  'panel:create': (panel: Panel) => void;
  'panel:update': (id: string, updates: Partial<Panel>) => void;
  'panel:delete': (id: string) => void;
  'panel:focus': (id: string) => void;
  'canvas:save': (state: CanvasState) => Promise<void>;
  'canvas:load': () => Promise<CanvasState>;
  'workspace:list': () => Promise<string[]>;
  'workspace:switch': (name: string) => Promise<CanvasState>;
  'workspace:save': (name: string, state: CanvasState) => Promise<void>;
  'extension:list': () => Promise<ExtensionManifest[]>;
  'extension:activate': (id: string) => Promise<void>;
  'extension:webview:html': (extensionId: string, viewId: string) => Promise<string>;
  'extension:webview:message': (extensionId: string, viewId: string, message: unknown) => void;
}
