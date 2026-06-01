import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { CanvasState, ExtensionManifest } from '../shared/types.js';

const api = {
  loadCanvas: (): Promise<CanvasState> => ipcRenderer.invoke('canvas:load'),
  saveCanvas: (state: CanvasState): Promise<void> => ipcRenderer.invoke('canvas:save', state),
  listWorkspaces: (): Promise<string[]> => ipcRenderer.invoke('workspace:list'),
  switchWorkspace: (name: string): Promise<CanvasState> => ipcRenderer.invoke('workspace:switch', name),
  saveWorkspace: (name: string, state: CanvasState): Promise<void> =>
    ipcRenderer.invoke('workspace:save', name, state),
  listExtensions: (): Promise<ExtensionManifest[]> => ipcRenderer.invoke('extension:list'),
  activateExtension: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('extension:activate', id),
  getExtensionWebview: (extensionId: string, viewId: string): Promise<string | null> =>
    ipcRenderer.invoke('extension:webview:html', extensionId, viewId),
  sendExtensionMessage: (extensionId: string, viewId: string, message: unknown): Promise<void> =>
    ipcRenderer.invoke('extension:webview:message', extensionId, viewId, message),
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
};

contextBridge.exposeInMainWorld('canvasAPI', api);

export type CanvasAPI = typeof api;
