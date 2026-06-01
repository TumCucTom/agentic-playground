// JSON-RPC protocol between the main process and the extension host process.
// Kept simple — one request type and one event type, both as string envelopes.
// Each request carries a numeric id; the response echoes it so the caller
// can correlate responses to pending promises.

import { ExtensionManifest } from '../shared/types';

export type HostRequest =
  | { id: number; kind: 'listExtensions' }
  | { id: number; kind: 'activate'; extensionId: string }
  | { id: number; kind: 'getWebviewHtml'; extensionId: string; viewId: string }
  | { id: number; kind: 'webviewMessage'; extensionId: string; viewId: string; message: unknown }
  | { id: number; kind: 'shutdown' };

export type HostResponse =
  | { id: number; kind: 'listExtensions'; manifests: ExtensionManifest[] }
  | { id: number; kind: 'activate'; ok: boolean; error?: string }
  | { id: number; kind: 'getWebviewHtml'; html: string | null; error?: string }
  | { id: number; kind: 'webviewMessage'; ok: boolean }
  | { id: number; kind: 'shutdown' }
  | { id: number; kind: 'error'; message: string };

export type HostEvent =
  | { kind: 'webviewChanged'; extensionId: string; viewId: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string };
