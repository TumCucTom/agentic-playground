// The `vscode` module shim exposed to extension code.
//
// Extensions call this API to register commands and webview panels. The
// shim translates those calls into messages that get sent to the main
// process and ultimately rendered in the renderer as canvas panels.

import { HostEvent } from './protocol';

type CommandHandler = (...args: unknown[]) => unknown;
type WebviewMessageHandler = (message: unknown) => void;

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
  // Returns HTML to render. The `message` handler is called when the
  // webview posts a message back to the extension.
  resolveHtml: (messageHandler: WebviewMessageHandler) => Promise<string> | string;
}

interface ExtensionAPI {
  id: string;
  commands: CommandEntry[];
  webviewProviders: WebviewProviderEntry[];
  webviewMessageHandlers: Map<string, WebviewMessageHandler>;
}

export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionAPI>();
  private sendEvent: (event: HostEvent) => void;

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
      webviewMessageHandlers: new Map(),
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
}

// Build the `vscode` shim for a given extension. The shim is bound to
// the extension's namespace so multiple extensions don't collide.
export function buildVSCodeShim(
  extensionId: string,
  registry: ExtensionRegistry
): any {
  const api = registry.createAPI(extensionId);

  return {
    window: {
      registerWebviewViewProvider(viewId: string, provider: {
        title: string;
        resolveWebviewView: (webview: {
          html: string;
          onDidReceiveMessage: (handler: WebviewMessageHandler) => void;
        }) => void;
      }) {
        // Stash a resolver that the host can call later when the renderer
        // requests HTML for this view.
        api.webviewProviders.push({
          extensionId,
          viewId,
          title: provider.title,
          resolveHtml: (handler) => {
            return new Promise<string>((resolveHtml) => {
              let captured = '';
              provider.resolveWebviewView({
                html: '',
                onDidReceiveMessage: (h) => {
                  api.webviewMessageHandlers.set(viewId, h);
                },
              });
              // Provider is expected to call webview.html = "..." in their
              // implementation. We capture the last-set html.
              const orig = provider.resolveWebviewView.toString();
              // Simpler approach: ask the provider to resolve, return its html
              try {
                const html = resolveProviderHtml(provider);
                resolveHtml(html);
              } catch (err) {
                resolveHtml(
                  `<html><body><pre>Error: ${(err as Error).message}</pre></body></html>`
                );
              }
            });
          },
        });
        return { dispose: () => {} };
      },
      createWebviewPanel(viewId: string, title: string) {
        api.webviewProviders.push({
          extensionId,
          viewId,
          title,
          resolveHtml: () => {
            try {
              return resolveProviderHtml({
                title,
                resolveWebviewView: (webview) => {
                  (webview as any).html = (webview as any).html || '';
                },
              });
            } catch (err) {
              return `<html><body><pre>Error: ${(err as Error).message}</pre></body></html>`;
            }
          },
        });
        return {
          webview: {
            html: '',
            onDidReceiveMessage: (h: WebviewMessageHandler) => {
              api.webviewMessageHandlers.set(viewId, h);
            },
            postMessage: (msg: unknown) => {
              registry.handleWebviewMessage(extensionId, viewId, msg);
            },
          },
          dispose: () => {},
        };
      },
      showInformationMessage(message: string) {
        registry['sendEvent']({
          kind: 'log',
          level: 'info',
          message: `[${extensionId}] ${message}`,
        });
        return Promise.resolve(undefined);
      },
    },
    commands: {
      registerCommand(command: string, handler: CommandHandler) {
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
    },
    workspace: {
      getConfiguration(_section?: string) {
        return {
          get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
          update: () => Promise.resolve(),
        };
      },
      workspaceFolders: [],
    },
    ExtensionContext: class {},
    ViewColumn: { One: 1, Two: 2, Three: 3 },
  };
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
