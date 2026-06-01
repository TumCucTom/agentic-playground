// The `vscode` module shim exposed to extension code.
//
// Extensions call this API to register commands, webview panels, status
// bar items, output channels, and progress indicators. The shim
// translates those calls into messages that get sent to the main
// process and ultimately rendered in the renderer as canvas UI.

import { HostEvent } from './protocol';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

type Thenable<T> = PromiseLike<T>;
type CommandHandler = (...args: unknown[]) => unknown;
type WebviewMessageHandler = (message: unknown) => void;
type TreeDataProvider<T> = {
  getTreeItem: (element: T) => any;
  getChildren: (element?: T) => Thenable<T[]>;
};
type ProviderWithResolve<T> = TreeDataProvider<T> & {
  resolveTreeItem?: (item: any, element: T) => Thenable<any>;
};
type TreeViewProviderEntry = {
  extensionId: string;
  viewId: string;
  title: string;
  provider: ProviderWithResolve<any>;
};

interface CommandEntry {
  command: string;
  title: string;
  category?: string;
  handler: CommandHandler;
}

interface WebviewProviderEntry {
  extensionId: string;
  viewId: string;
  title: string;
  resolveHtml: (messageHandler: WebviewMessageHandler) => Promise<string> | string;
}

interface StatusBarItem {
  id: string;
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  alignment: 'left' | 'right';
  priority: number;
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

interface OutputChannel {
  name: string;
  append: (text: string) => void;
  appendLine: (line: string) => void;
  clear: () => void;
  show: (preserveFocus?: boolean) => void;
  hide: () => void;
  dispose: () => void;
}

interface ExtensionAPI {
  id: string;
  commands: CommandEntry[];
  webviewProviders: WebviewProviderEntry[];
  treeViewProviders: TreeViewProviderEntry[];
  webviewMessageHandlers: Map<string, WebviewMessageHandler>;
  statusBarItems: StatusBarItem[];
  outputChannels: OutputChannel[];
  subscriptions: { dispose: () => void }[];
}

export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionAPI>();
  private sendEvent: (event: HostEvent) => void;
  private config: Record<string, unknown> = {};

  constructor(sendEvent: (event: HostEvent) => void) {
    this.sendEvent = sendEvent;
  }

  createAPI(extensionId: string): ExtensionAPI {
    const existing = this.extensions.get(extensionId);
    if (existing) return existing;

    const api: ExtensionAPI = {
      id: extensionId,
      commands: [],
      webviewProviders: [],
      treeViewProviders: [],
      webviewMessageHandlers: new Map(),
      statusBarItems: [],
      outputChannels: [],
      subscriptions: [],
    };
    this.extensions.set(extensionId, api);
    return api;
  }

  getAPI(extensionId: string): ExtensionAPI | undefined {
    return this.extensions.get(extensionId);
  }

  list(): ExtensionAPI[] {
    return Array.from(this.extensions.values());
  }

  async handleWebviewMessage(extensionId: string, viewId: string, message: unknown): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext) return;
    const handler = ext.webviewMessageHandlers.get(viewId);
    if (handler) {
      try {
        await handler(message);
      } catch (err) {
        this.sendEvent({
          kind: 'log',
          level: 'error',
          message: `Webview message handler error in ${extensionId}/${viewId}: ${(err as Error).message}`,
        });
      }
    }
  }

  setConfig(extensionId: string, key: string, value: unknown): void {
    this.config[`${extensionId}:${key}`] = value;
  }

  getConfig(extensionId: string, key: string): unknown {
    return this.config[`${extensionId}:${key}`];
  }
}

// URI helper class
class Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;

  private constructor(scheme: string, authority: string, p: string, query: string, fragment: string) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = p;
    this.query = query;
    this.fragment = fragment;
  }

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }

  static parse(value: string): Uri {
    const m = value.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
    if (!m) return new Uri('file', '', value, '', '');
    return new Uri(m[1], m[2], m[3] || '/', m[4] || '', m[5] || '');
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    let s = `${this.scheme}://`;
    if (this.authority) s += this.authority;
    s += this.path;
    if (this.query) s += this.query;
    if (this.fragment) s += this.fragment;
    return s;
  }

  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }
}

// EventEmitter for the extensions
class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    } };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}

// Build the `vscode` shim for a given extension. The shim is bound to
// the extension's namespace so multiple extensions don't collide.
export function buildVSCodeShim(
  extensionId: string,
  registry: ExtensionRegistry
): any {
  const api = registry.createAPI(extensionId);

  const shim: any = {
    // ===== URI =====
    Uri,

    // ===== EventEmitter =====
    EventEmitter,

    // ===== Enums =====
    ViewColumn: { One: 1, Two: 2, Three: 3, Beside: -2, Active: -1 },
    ProgressLocation: {
      SourceControl: 1,
      Window: 10,
      Notification: 15,
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    FileType: {
      Unknown: 0,
      File: 1,
      Directory: 2,
      SymbolicLink: 64,
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeColor: function (id: string) {
      return { id };
    },
    ThemeIcon: function (id: string, color?: any) {
      return { id, color };
    },

    // ===== env =====
    env: {
      appName: 'Canvas Workspace',
      appRoot: process.cwd(),
      language: 'en',
      sessionId: 'session-' + Date.now(),
      isNewAppInstall: false,
      isTelemetryEnabled: false,
      machineId: 'local-machine',
      shell: process.env.SHELL || '/bin/zsh',
      uriScheme: 'canvas',
      openExternal: async (uri: Uri) => {
        registry['sendEvent']({
          kind: 'log',
          level: 'info',
          message: `[${extensionId}] openExternal: ${uri.toString()}`,
        });
      },
      clipboard: {
        readText: async () => '',
        writeText: async (text: string) => undefined,
      },
    },

    // ===== window =====
    window: {
      registerWebviewViewProvider(viewId: string, provider: any) {
        api.webviewProviders.push({
          extensionId,
          viewId,
          title: provider.title,
          resolveHtml: () => {
            try {
              return resolveProviderHtml(provider);
            } catch (err) {
              return `<html><body><pre>Error: ${(err as Error).message}</pre></body></html>`;
            }
          },
        });
        return { dispose: () => {} };
      },

      createWebviewPanel(viewId: string, title: string, _column?: any, _options?: any) {
        let currentHtml = '';
        let messageHandler: WebviewMessageHandler | null = null;
        const panel = {
          webview: {
            get html() {
              return currentHtml;
            },
            set html(v: string) {
              currentHtml = v;
            },
            options: _options || {},
            csp: undefined as string | undefined,
            onDidReceiveMessage: (h: WebviewMessageHandler) => {
              messageHandler = h;
              api.webviewMessageHandlers.set(viewId, h);
            },
            postMessage: (msg: unknown) => {
              if (messageHandler) messageHandler(msg);
            },
            asWebviewUri: (uri: Uri) => uri,
          },
          reveal: () => {},
          dispose: () => {},
          onDidDispose: (cb: () => void) => ({ dispose: () => {} }),
          onDidChangeViewState: (cb: () => void) => ({ dispose: () => {} }),
        };
        api.webviewProviders.push({
          extensionId,
          viewId,
          title,
          resolveHtml: () => currentHtml,
        });
        return panel;
      },

      showInformationMessage(message: string, ..._items: string[]) {
        registry['sendEvent']({
          kind: 'log',
          level: 'info',
          message: `[${extensionId}] ${message}`,
        });
        return Promise.resolve(undefined);
      },
      showWarningMessage(message: string, ..._items: string[]) {
        registry['sendEvent']({
          kind: 'log',
          level: 'warn',
          message: `[${extensionId}] ${message}`,
        });
        return Promise.resolve(undefined);
      },
      showErrorMessage(message: string, ..._items: string[]) {
        registry['sendEvent']({
          kind: 'log',
          level: 'error',
          message: `[${extensionId}] ${message}`,
        });
        return Promise.resolve(undefined);
      },

      createOutputChannel(name: string): OutputChannel {
        const channel: OutputChannel = {
          name,
          append: (text: string) => {
            registry['sendEvent']({
              kind: 'log',
              level: 'info',
              message: `[${extensionId}:${name}] ${text}`,
            });
          },
          appendLine: (line: string) => {
            registry['sendEvent']({
              kind: 'log',
              level: 'info',
              message: `[${extensionId}:${name}] ${line}`,
            });
          },
          clear: () => {},
          show: () => {},
          hide: () => {},
          dispose: () => {
            api.outputChannels = api.outputChannels.filter((c) => c !== channel);
          },
        };
        api.outputChannels.push(channel);
        return channel;
      },

      createStatusBarItem(alignment: 'left' | 'right' = 'left', priority = 0): StatusBarItem {
        const item: StatusBarItem = {
          id: `${extensionId}:${api.statusBarItems.length}`,
          text: '',
          tooltip: undefined,
          command: undefined,
          alignment,
          priority,
          show: () => {},
          hide: () => {},
          dispose: () => {
            api.statusBarItems = api.statusBarItems.filter((i) => i !== item);
          },
        };
        api.statusBarItems.push(item);
        return item;
      },

      withProgress: async <T>(
        options: { location: number; title?: string; cancellable?: boolean },
        task: (progress: { report: (value: { message?: string; increment?: number }) => void }) => Thenable<T>
      ): Promise<T> => {
        const progress = {
          report: (value: { message?: string; increment?: number }) => {
            registry['sendEvent']({
              kind: 'log',
              level: 'info',
              message: `[${extensionId}] progress: ${value.message ?? value.increment ?? ''}`,
            });
          },
        };
        return task(progress);
      },

      activeTextEditor: undefined,
      visibleTextEditors: [],
      onDidChangeActiveTextEditor: new EventEmitter().event,
      onDidChangeTextEditorSelection: new EventEmitter().event,
    },

    // ===== commands =====
    commands: {
      registerCommand(command: string, handler: CommandHandler, _thisArg?: unknown) {
        api.commands.push({ command, title: command, handler });
        return { dispose: () => {} };
      },
      registerTextEditorCommand(command: string, handler: CommandHandler) {
        api.commands.push({ command, title: command, handler });
        return { dispose: () => {} };
      },
      executeCommand(command: string, ...args: unknown[]) {
        for (const ext of registry.list()) {
          const cmd = ext.commands.find((c) => c.command === command);
          if (cmd) {
            return Promise.resolve(cmd.handler(...args));
          }
        }
        return Promise.reject(new Error(`Command not found: ${command}`));
      },
      getCommands: async () => {
        const cmds: string[] = [];
        for (const ext of registry.list()) {
          for (const c of ext.commands) cmds.push(c.command);
        }
        return cmds;
      },
    },

    // ===== workspace =====
    workspace: {
      workspaceFolders: [] as any[],
      getConfiguration: (section?: string) => {
        const configSection = section || '';
        return {
          get: <T>(key: string, defaultValue?: T): T | undefined => {
            const v = registry.getConfig(extensionId, `${configSection}.${key}`);
            return (v === undefined ? defaultValue : v) as T | undefined;
          },
          has: (key: string) => registry.getConfig(extensionId, `${configSection}.${key}`) !== undefined,
          inspect: () => undefined,
          update: (key: string, value: unknown) => {
            registry.setConfig(extensionId, `${configSection}.${key}`, value);
            return Promise.resolve();
          },
        };
      },
      onDidChangeConfiguration: new EventEmitter().event,
      onDidChangeWorkspaceFolders: new EventEmitter().event,
      fs: {
        readFile: async (uri: Uri): Promise<Uint8Array> => {
          const data = await fs.promises.readFile(uri.fsPath);
          return new Uint8Array(data);
        },
        writeFile: async (uri: Uri, content: Uint8Array): Promise<void> => {
          await fs.promises.writeFile(uri.fsPath, Buffer.from(content));
        },
        stat: async (uri: Uri) => {
          const s = await fs.promises.stat(uri.fsPath);
          return {
            type: s.isDirectory() ? 2 : 1,
            ctime: s.ctimeMs,
            mtime: s.mtimeMs,
            size: s.size,
          };
        },
        readDirectory: async (uri: Uri) => {
          const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
          return entries.map((e) => [
            e.name,
            e.isDirectory() ? 2 : 1,
          ] as [string, number]);
        },
        exists: async (uri: Uri) => {
          try {
            await fs.promises.access(uri.fsPath);
            return true;
          } catch {
            return false;
          }
        },
      },
      findFiles: async (include: string, _exclude?: string) => {
        // Simple glob implementation - just return the include pattern as-is
        return [Uri.file(include)];
      },
      getWorkspaceFolder: (_uri: Uri) => undefined,
    },

    // ===== extensions =====
    extensions: {
      getExtension: (id: string) => {
        if (id === extensionId) {
          return {
            id,
            extensionUri: Uri.file(path.join(os.homedir(), '.canvas-workspace', 'extensions', id)),
            extensionPath: path.join(os.homedir(), '.canvas-workspace', 'extensions', id),
            isActive: true,
            packageJSON: {},
            exports: undefined,
            activate: async () => undefined,
          };
        }
        return undefined;
      },
      all: [],
    },

    // ===== TreeView =====
    createTreeView(viewId: string, options: { treeDataProvider: ProviderWithResolve<any>; showCollapseAll?: boolean }) {
      api.treeViewProviders.push({
        extensionId,
        viewId,
        title: viewId,
        provider: options.treeDataProvider,
      });
      return {
        reveal: () => {},
        dispose: () => {
          api.treeViewProviders = api.treeViewProviders.filter((p) => p.viewId !== viewId);
        },
        onDidExpandElement: new EventEmitter().event,
        onDidCollapseElement: new EventEmitter().event,
      };
    },

    // ===== Extension context =====
    ExtensionContext: class {},
  };

  return shim;
}

// Resolves HTML for a provider by executing its resolveWebviewView method
// with a webview stub that captures the html property.
function resolveProviderHtml(provider: {
  title: string;
  resolveWebviewView: (webview: {
    html: string;
    onDidReceiveMessage: (handler: WebviewMessageHandler) => void;
  }) => void;
}): string {
  let captured = '';
  let messageHandler: WebviewMessageHandler | null = null;
  const webview: any = {
    get html() {
      return captured;
    },
    set html(v: string) {
      captured = v;
    },
    onDidReceiveMessage: (h: WebviewMessageHandler) => {
      messageHandler = h;
    },
    postMessage: (msg: unknown) => {
      if (messageHandler) messageHandler(msg);
    },
  };
  provider.resolveWebviewView(webview);
  return captured || `<html><body><em>${provider.title} (no content)</em></body></html>`;
}
