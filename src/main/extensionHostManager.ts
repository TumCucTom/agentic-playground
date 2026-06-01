// Spawns the extension host as a child process and brokers RPC between
// the main process and the extension host.

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { HostRequest, HostResponse, HostEvent } from '../extensionHost/protocol';
import { ExtensionManifest } from '../shared/types';

type RequestBody =
  | { kind: 'listExtensions' }
  | { kind: 'activate'; extensionId: string }
  | { kind: 'getWebviewHtml'; extensionId: string; viewId: string }
  | { kind: 'webviewMessage'; extensionId: string; viewId: string; message: unknown }
  | { kind: 'shutdown' };

export class ExtensionHostManager {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<
    number,
    { resolve: (r: HostResponse) => void; reject: (e: Error) => void }
  >();
  private nextRequestId = 1;
  private manifests: ExtensionManifest[] = [];

  constructor(private extensionsDir: string) {}

  start(): void {
    if (this.process) return;

    const extHostPath = path.join(__dirname, '../extensionHost/index.js');
    this.process = spawn(process.execPath, [extHostPath], {
      env: {
        ...process.env,
        CANVAS_EXTENSIONS_DIR: this.extensionsDir,
        // Suppress ELECTRON_RUN_AS_NODE warning when not in Electron
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({
      input: this.process.stdout!,
      terminal: false,
    });
    rl.on('line', (line) => this.handleLine(line));

    this.process.stderr?.on('data', (data) => {
      console.error('[extension host stderr]', data.toString());
    });

    this.process.on('exit', (code) => {
      console.log(`[extension host] exited with code ${code}`);
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error('[extension host] error:', err);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed.event) {
        this.handleEvent(parsed.event as HostEvent);
      } else if (parsed.response) {
        this.handleResponse(parsed.response as HostResponse);
      }
    } catch (err) {
      console.error('[extension host] parse error:', err);
    }
  }

  private handleResponse(response: HostResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
      return;
    }
    if (response.kind === 'listExtensions') {
      this.manifests = response.manifests;
    }
  }

  private handleEvent(event: HostEvent): void {
    if (event.kind === 'log') {
      const prefix = `[extension host]`;
      if (event.level === 'error') console.error(prefix, event.message);
      else if (event.level === 'warn') console.warn(prefix, event.message);
      else console.log(prefix, event.message);
    } else if (event.kind === 'webviewChanged') {
      console.log(`[extension host] webview changed: ${event.extensionId}/${event.viewId}`);
    }
  }

  private sendRequest(request: RequestBody): Promise<HostResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('Extension host not running'));
        return;
      }
      const id = this.nextRequestId++;
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.process.stdin!.write(JSON.stringify({ ...request, id }) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err as Error);
        return;
      }
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve({ id, kind: 'error', message: 'Response timeout' });
        }
      }, 5000);
    });
  }

  async listExtensions(): Promise<ExtensionManifest[]> {
    // Read manifests directly from disk; the child process also returns them
    // but the main process can also discover them independently.
    if (!this.process) this.start();
    const fs = require('fs') as typeof import('fs');
    if (!fs.existsSync(this.extensionsDir)) return [];
    const out: ExtensionManifest[] = [];
    for (const entry of fs.readdirSync(this.extensionsDir)) {
      const manifestPath = path.join(this.extensionsDir, entry, 'package.json');
      if (fs.existsSync(manifestPath)) {
        try {
          out.push(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
        } catch {
          // skip
        }
      }
    }
    this.manifests = out;
    return out;
  }

  async activateExtension(extensionId: string): Promise<{ ok: boolean; error?: string }> {
    return this.sendRequest({ kind: 'activate', extensionId }) as Promise<any>;
  }

  async getWebviewHtml(extensionId: string, viewId: string): Promise<string | null> {
    const result = (await this.sendRequest({
      kind: 'getWebviewHtml',
      extensionId,
      viewId,
    })) as Extract<HostResponse, { kind: 'getWebviewHtml' }>;
    return result.html;
  }

  async sendWebviewMessage(extensionId: string, viewId: string, message: unknown): Promise<void> {
    await this.sendRequest({ kind: 'webviewMessage', extensionId, viewId, message });
  }
}
