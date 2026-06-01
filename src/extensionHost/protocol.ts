// JSON-RPC protocol between the main process and the extension host process.
// Kept simple — one request type and one event type, both as string envelopes.

import { ExtensionManifest } from '../shared/types';

export type HostRequest =
  | { kind: 'listExtensions' }
  | { kind: 'activate'; extensionId: string }
  | { kind: 'getWebviewHtml'; extensionId: string; viewId: string }
  | { kind: 'webviewMessage'; extensionId: string; viewId: string; message: unknown }
  | { kind: 'shutdown' };

export type HostResponse =
  | { kind: 'listExtensions'; manifests: ExtensionManifest[] }
  | { kind: 'activate'; ok: boolean; error?: string }
  | { kind: 'getWebviewHtml'; html: string | null; error?: string }
  | { kind: 'webviewMessage'; ok: boolean }
  | { kind: 'shutdown' }
  | { kind: 'error'; message: string };

export type HostEvent =
  | { kind: 'webviewChanged'; extensionId: string; viewId: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string };
