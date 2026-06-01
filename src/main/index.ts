import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { CanvasState, ExtensionManifest } from '../shared/types.js';
import { ExtensionHostManager } from './extensionHostManager.js';
import { registerPtyHandlers, ptyManager } from './ptyManager.js';
import { taskMonitor, setTaskMonitorWindow } from './taskMonitor.js';

const isDev = !app.isPackaged;
const userDataPath = app.getPath('userData');
const workspacesDir = path.join(userDataPath, 'workspaces');
const extensionsDir = path.join(userDataPath, 'extensions');

let mainWindow: BrowserWindow | null = null;
let extensionHost: ExtensionHostManager | null = null;

function ensureDirectories(): void {
  if (!fs.existsSync(workspacesDir)) {
    fs.mkdirSync(workspacesDir, { recursive: true });
  }
  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }
}

function installBundledExtensions(): void {
  // In dev, the bundled extensions live in <project>/bundled-extensions.
  // In a packaged app, they'd live in <app>/resources/extensions. We try
  // both and copy any extension manifest dir that doesn't already exist.
  const candidates: string[] = [];
  if (isDev) {
    candidates.push(path.join(app.getAppPath(), 'bundled-extensions'));
    // Fallback: walk up from __dirname to find bundled-extensions.
    // This handles the case where Playwright launches Electron with
    // dist/main/index.js as the entry, and app.getAppPath() is the
    // dist directory rather than the project root.
    candidates.push(path.join(__dirname, '..', '..', 'bundled-extensions'));
    candidates.push(path.join(__dirname, '..', 'bundled-extensions'));
  }
  // resourcesPath is the same as app.getAppPath() in dev
  if (process.resourcesPath && process.resourcesPath !== app.getAppPath()) {
    candidates.push(path.join(process.resourcesPath, 'extensions'));
    candidates.push(path.join(process.resourcesPath, 'app', 'bundled-extensions'));
  }

  for (const srcDir of candidates) {
    if (!fs.existsSync(srcDir)) continue;
    for (const entry of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, entry);
      const dest = path.join(extensionsDir, entry);
      if (fs.existsSync(dest)) continue;
      try {
        copyDirSync(src, dest);
        console.log(`Installed bundled extension: ${entry}`);
      } catch (err) {
        console.error(`Failed to install extension ${entry}:`, err);
      }
    }
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getActiveWorkspaceName(): string {
  const stateFile = path.join(workspacesDir, '.active');
  if (fs.existsSync(stateFile)) {
    return fs.readFileSync(stateFile, 'utf-8').trim() || 'default';
  }
  return 'default';
}

function setActiveWorkspaceName(name: string): void {
  fs.writeFileSync(path.join(workspacesDir, '.active'), name);
}

function workspaceFilePath(name: string): string {
  return path.join(workspacesDir, `${name}.json`);
}

function emptyCanvasState(): CanvasState {
  return {
    panels: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedPanelIds: [],
    workspaceName: 'default',
    lastUpdated: Date.now(),
  };
}

function loadCanvasState(name: string): CanvasState {
  const file = workspaceFilePath(name);
  if (!fs.existsSync(file)) {
    return { ...emptyCanvasState(), workspaceName: name };
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as CanvasState;
  } catch (err) {
    console.error(`Failed to load workspace ${name}:`, err);
    return { ...emptyCanvasState(), workspaceName: name };
  }
}

function saveCanvasState(name: string, state: CanvasState): void {
  const file = workspaceFilePath(name);
  state.lastUpdated = Date.now();
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function listWorkspaces(): string[] {
  if (!fs.existsSync(workspacesDir)) return [];
  return fs
    .readdirSync(workspacesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

function loadExtensions(): ExtensionManifest[] {
  if (!fs.existsSync(extensionsDir)) return [];
  const manifests: ExtensionManifest[] = [];
  for (const entry of fs.readdirSync(extensionsDir)) {
    const manifestPath = path.join(extensionsDir, entry, 'package.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
        manifests.push(manifest);
      } catch (err) {
        console.error(`Failed to load extension ${entry}:`, err);
      }
    }
  }
  return manifests;
}

async function readDirectoryTree(rootPath: string, maxDepth = 4, currentDepth = 0): Promise<any[]> {
  if (currentDepth >= maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  // Skip heavy / hidden directories
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__']);
  const result: any[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.vscode') continue;
    if (SKIP.has(entry.name)) continue;
    const full = path.join(rootPath, entry.name);
    const item: any = {
      name: entry.name,
      isDir: entry.isDirectory(),
      path: full,
    };
    if (entry.isDirectory()) {
      item.children = await readDirectoryTree(full, maxDepth, currentDepth + 1);
    }
    result.push(item);
  }
  // Sort: dirs first, then alphabetical
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function registerIpcHandlers(): void {
  ipcMain.handle('canvas:load', async () => {
    return loadCanvasState(getActiveWorkspaceName());
  });

  ipcMain.handle('canvas:save', async (_event: IpcMainInvokeEvent, state: CanvasState) => {
    saveCanvasState(getActiveWorkspaceName(), state);
  });

  ipcMain.handle('workspace:list', async () => {
    return listWorkspaces();
  });

  ipcMain.handle('workspace:switch', async (_event: IpcMainInvokeEvent, name: string) => {
    setActiveWorkspaceName(name);
    return loadCanvasState(name);
  });

  ipcMain.handle('workspace:save', async (_event: IpcMainInvokeEvent, name: string, state: CanvasState) => {
    saveCanvasState(name, state);
  });

  ipcMain.handle('extension:list', async () => {
    if (extensionHost) {
      return extensionHost.listExtensions();
    }
    return loadExtensions();
  });

  ipcMain.handle('extension:activate', async (_event: IpcMainInvokeEvent, id: string) => {
    if (!extensionHost) return { ok: false, error: 'Extension host not running' };
    return extensionHost.activateExtension(id);
  });

  ipcMain.handle(
    'extension:webview:html',
    async (_event: IpcMainInvokeEvent, extensionId: string, viewId: string) => {
      if (!extensionHost) return null;
      return extensionHost.getWebviewHtml(extensionId, viewId);
    }
  );

  ipcMain.handle(
    'extension:webview:message',
    async (_event: IpcMainInvokeEvent, extensionId: string, viewId: string, message: unknown) => {
      if (!extensionHost) return;
      await extensionHost.sendWebviewMessage(extensionId, viewId, message);
    }
  );

  ipcMain.handle('fs:listDir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
    return readDirectoryTree(dirPath);
  });

  ipcMain.handle('fs:readFile', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read ${filePath}: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('fs:writeFile', async (_event: IpcMainInvokeEvent, filePath: string, content: string) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write ${filePath}: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('fs:stat', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const s = await fs.promises.stat(filePath);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
        modified: s.mtimeMs,
      };
    } catch (err) {
      throw new Error(`Failed to stat ${filePath}: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('fs:homeDir', async () => {
    return app.getPath('home');
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Forward renderer console messages to main process stdout for visibility
  mainWindow.webContents.on('console-message', (_event, level, message, line, source) => {
    const levelLabel = ['debug', 'info', 'warn', 'error'][level] || 'log';
    console.log(`[renderer ${levelLabel}] ${message} (${source}:${line})`);
  });

  setTaskMonitorWindow(mainWindow);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] Process gone: ${details.reason}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ensureDirectories();
  installBundledExtensions();
  extensionHost = new ExtensionHostManager(extensionsDir);
  extensionHost.start();
  registerIpcHandlers();
  registerPtyHandlers(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (extensionHost) {
    extensionHost.stop();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
