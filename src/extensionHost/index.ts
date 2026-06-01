// Extension host entry point.
//
// Spawned as a child process by the main process. Communicates via
// stdio using newline-delimited JSON envelopes (one JSON object per
// line on stdin/stdout).

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { HostRequest, HostResponse, HostEvent } from './protocol';
import { ExtensionRegistry, buildVSCodeShim } from './api';
import { ExtensionManifest } from '../shared/types';

const sendEvent = (event: HostEvent) => {
  process.stdout.write(JSON.stringify({ event }) + '\n');
};

const sendResponse = (response: HostResponse) => {
  process.stdout.write(JSON.stringify({ response }) + '\n');
};

const registry = new ExtensionRegistry(sendEvent);

// Get the extensions dir and current workspace from env (set by main process).
const extensionsDir = process.env.CANVAS_EXTENSIONS_DIR;
if (!extensionsDir) {
  sendResponse({ id: 0, kind: 'error', message: 'CANVAS_EXTENSIONS_DIR not set' });
  process.exit(1);
}

function loadManifests(): ExtensionManifest[] {
  if (!fs.existsSync(extensionsDir!)) return [];
  const manifests: ExtensionManifest[] = [];
  for (const entry of fs.readdirSync(extensionsDir!)) {
    const manifestPath = path.join(extensionsDir!, entry, 'package.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
        manifests.push(manifest);
      } catch (err) {
        sendEvent({
          kind: 'log',
          level: 'error',
          message: `Failed to load extension manifest at ${manifestPath}: ${(err as Error).message}`,
        });
      }
    }
  }
  return manifests;
}

const loadedExtensions = new Map<string, { manifest: ExtensionManifest; exports: any }>();

async function activateExtension(extensionId: string): Promise<{ ok: boolean; error?: string }> {
  if (loadedExtensions.has(extensionId)) return { ok: true };
  const manifests = loadManifests();
  const manifest = manifests.find((m) => m.id === extensionId);
  if (!manifest) {
    return { ok: false, error: `Extension not found: ${extensionId}` };
  }

  const extDir = path.join(extensionsDir!, extensionId);
  const mainPath = path.join(extDir, manifest.main);

  if (!fs.existsSync(mainPath)) {
    return { ok: false, error: `Main file not found: ${mainPath}` };
  }

  try {
    // Clear require cache so re-activation works
    delete require.cache[require.resolve(mainPath)];
    const mod = require(mainPath);
    const shim = buildVSCodeShim(extensionId, registry);

    if (typeof mod.activate === 'function') {
      await mod.activate({
        subscriptions: [],
        globalState: new Map(),
        workspaceState: new Map(),
        extensionPath: extDir,
      });
    } else if (typeof mod.default === 'function') {
      // Extensions may export an activate function as default
      await mod.default(shim);
    } else if (typeof mod === 'function') {
      await mod(shim);
    } else {
      return { ok: false, error: 'Extension does not export an activate function' };
    }

    loadedExtensions.set(extensionId, { manifest, exports: mod });
    sendEvent({ kind: 'webviewChanged', extensionId, viewId: '*' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function getWebviewHtml(extensionId: string, viewId: string): Promise<string | null> {
  const api = registry.getAPI(extensionId);
  if (!api) {
    // Auto-activate
    const result = await activateExtension(extensionId);
    if (!result.ok) return `<html><body><pre>Activation error: ${result.error}</pre></body></html>`;
  }
  const refreshed = registry.getAPI(extensionId);
  if (!refreshed) return null;
  const provider = refreshed.webviewProviders.find((p) => p.viewId === viewId);
  if (!provider) {
    return `<html><body><pre>View not found: ${viewId}</pre></body></html>`;
  }
  try {
    return await provider.resolveHtml(() => {});
  } catch (err) {
    return `<html><body><pre>Error: ${(err as Error).message}</pre></body></html>`;
  }
}

// Read requests from stdin, one JSON object per line.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request: HostRequest;
  try {
    request = JSON.parse(line) as HostRequest;
  } catch (err) {
    sendResponse({ id: -1, kind: 'error', message: `Invalid JSON: ${(err as Error).message}` });
    return;
  }

  try {
    switch (request.kind) {
      case 'listExtensions': {
        const manifests = loadManifests();
        sendResponse({ id: request.id, kind: 'listExtensions', manifests });
        break;
      }
      case 'activate': {
        const result = await activateExtension(request.extensionId);
        sendResponse({ id: request.id, kind: 'activate', ...result });
        break;
      }
      case 'getWebviewHtml': {
        const html = await getWebviewHtml(request.extensionId, request.viewId);
        sendResponse({ id: request.id, kind: 'getWebviewHtml', html });
        break;
      }
      case 'webviewMessage': {
        await registry.handleWebviewMessage(request.extensionId, request.viewId, request.message);
        sendResponse({ id: request.id, kind: 'webviewMessage', ok: true });
        break;
      }
      case 'shutdown': {
        sendResponse({ id: request.id, kind: 'shutdown' });
        process.exit(0);
      }
    }
  } catch (err) {
    sendResponse({ id: request.id, kind: 'error', message: (err as Error).message });
  }
});

rl.on('close', () => {
  process.exit(0);
});

sendEvent({ kind: 'log', level: 'info', message: 'Extension host started' });
