import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { CanvasState, ExtensionManifest } from '../shared/types.js';

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
  children?: FileEntry[];
}

interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: number;
}

interface DesktopSource {
  id: string;
  name: string;
  appIcon: string | null;
  thumbnail: string | null;
  display_id?: string;
  pid?: number | null;
}

interface LaunchAppResult {
  ok: boolean;
  error?: string;
  pid?: number;
  appName?: string;
  appPath?: string;
}

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
  listDirectory: (dirPath: string): Promise<FileEntry[]> => ipcRenderer.invoke('fs:listDir', dirPath),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  stat: (filePath: string): Promise<FileStat> => ipcRenderer.invoke('fs:stat', filePath),
  homeDir: (): Promise<string> => ipcRenderer.invoke('fs:homeDir'),
  ptyCreate: (opts: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<{ id: string; pid: number }> =>
    ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),
  onPtyData: (handler: (id: string, data: string) => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; data: string }) =>
      handler(payload.id, payload.data);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.off('pty:data', listener);
  },
  onPtyExit: (handler: (id: string, code: number) => void) => {
    const listener = (_e: IpcRendererEvent, payload: { id: string; code: number }) =>
      handler(payload.id, payload.code);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.off('pty:exit', listener);
  },
  onTaskCompleted: (handler: (payload: { panelId: string; ptyId: string; kind: 'done' | 'failed' }) => void) => {
    const listener = (_e: IpcRendererEvent, payload: { panelId: string; ptyId: string; kind: 'done' | 'failed' }) =>
      handler(payload);
    ipcRenderer.on('task:completed', listener);
    return () => ipcRenderer.off('task:completed', listener);
  },
  setWindowBackground: (mode: 'black' | 'white' | 'system' | 'translucent'): Promise<void> =>
    ipcRenderer.invoke('window:background', mode),
  listDesktopSources: (): Promise<DesktopSource[]> => ipcRenderer.invoke('desktop:sources'),
  launchApp: (bundleId: string): Promise<LaunchAppResult> => ipcRenderer.invoke('app:launch', bundleId),
  killApp: (pid: number): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:kill', pid),
  reparentApp: (
    bundleId: string,
    target: { x: number; y: number; width: number; height: number }
  ): Promise<{ ok: boolean; pid?: number; error?: string }> =>
    ipcRenderer.invoke('app:reparent', { bundleId, target }),
  openSystemSettings: (pane: 'accessibility' | 'screenRecording'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('system:openSettings', pane),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  checkMediaAccess: (mediaType: 'screen' | 'microphone' | 'camera'): Promise<{ ok: boolean; status?: string; error?: string }> =>
    ipcRenderer.invoke('system:mediaAccess', mediaType),
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
};

contextBridge.exposeInMainWorld('canvasAPI', api);

export type CanvasAPI = typeof api;
export type { FileEntry, FileStat, DesktopSource, LaunchAppResult };
