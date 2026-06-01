import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, desktopCapturer, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execFile } from 'child_process';
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

// Track macOS apps we launched via the App Launcher panel, so we can kill
// them when the panel closes. Map pid → { bundleId, appName }.
interface LaunchedApp {
  bundleId: string;
  appName: string;
  spawnedAt: number;
}
const launchedApps = new Map<number, LaunchedApp>();

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
    layoutMode: 'canvas',
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

// Expand a leading "~" or "~/" to the user's home directory. Anything
// else is returned unchanged.
function expandHome(p: string): string {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// Poll the process list for a newly-launched app and return its pid.
// `open -nb <bundle>` returns immediately; the actual app process is a
// grandchild and may take a few hundred ms to register. We match by
// pgrep-ing the app's .app bundle path (resolved via mdfind) so we
// don't pick up unrelated processes with the same executable name
// (VS Code's process is literally called "Electron"). The app:launch
// handler inlines this logic now to avoid a race where `open -nb`
// spawns the new instance faster than the BEFORE snapshot is taken.
async function waitForAppPid(
  appName: string,
  bundleId: string,
  appPath: string,
  timeoutMs: number
): Promise<number | null> {
  void appName;
  void bundleId;
  if (!appPath) return null;
  const pgrep = () =>
    new Promise<number[]>((resolve) => {
      execFile('pgrep', ['-f', appPath], (_err, stdout) => {
        resolve(
          stdout
            .split('\n')
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isFinite(n))
        );
      });
    });
  const before = new Set(await pgrep());
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    const current = await pgrep();
    for (const p of current) {
      if (!before.has(p)) return p;
    }
  }
  return null;
}

async function readDirectoryTree(rootPath: string, maxDepth = 4, currentDepth = 0): Promise<any[]> {
  if (currentDepth >= maxDepth) return [];
  rootPath = expandHome(rootPath);
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
      return await fs.promises.readFile(expandHome(filePath), 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read ${filePath}: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('fs:writeFile', async (_event: IpcMainInvokeEvent, filePath: string, content: string) => {
    try {
      await fs.promises.writeFile(expandHome(filePath), content, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write ${filePath}: ${(err as Error).message}`);
    }
  });

  ipcMain.handle('fs:stat', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const s = await fs.promises.stat(expandHome(filePath));
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

  ipcMain.handle(
    'window:background',
    async (_event: IpcMainInvokeEvent, mode: 'black' | 'white' | 'system' | 'translucent') => {
      applyWindowBackground(mode);
    }
  );

  ipcMain.handle('desktop:sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
        display_id: (s as any).display_id,
        pid: (s as any).pid ?? null,
      }));
    } catch (err) {
      console.error('[desktopCapturer] getSources failed:', err);
      return [];
    }
  });

  ipcMain.handle('app:launch', async (_event, bundleId: string) => {
    // Launch a new instance of a macOS app by bundle id. The `-n` flag
    // forces a new instance even if one is already running; `-b` looks
    // up the bundle id via Launch Services. We then poll the process
    // list to find the child pid — `open` itself is a short-lived
    // launcher process and returns immediately.
    if (!bundleId || typeof bundleId !== 'string') {
      return { ok: false, error: 'bundleId required' };
    }

    // Resolve the bundle id to an .app path so we can pgrep for it.
    // We do this BEFORE the launch so the BEFORE snapshot in
    // waitForAppPid can include any pre-existing instances.
    let appName = bundleId;
    let appPath = '';
    try {
      const mdfindOut = await new Promise<string>((resolve, reject) => {
        execFile('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`], (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim().split('\n')[0] || '');
        });
      });
      if (mdfindOut) {
        appPath = mdfindOut;
        appName = path.basename(mdfindOut, '.app');
      }
    } catch {
      // mdfind may fail in sandboxed environments; we still proceed
      // with the bundle id as the name.
    }
    if (!appPath) {
      return { ok: false, error: `Could not resolve bundle id to an app: ${bundleId}` };
    }

    // Snapshot existing pids BEFORE launching. Anything in the
    // post-launch poll that isn't in this set is our new instance.
    const pgrepPids = () =>
      new Promise<number[]>((resolve) => {
        execFile('pgrep', ['-f', appPath], (_err, stdout) => {
          resolve(
            stdout.split('\n').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
          );
        });
      });
    const before = new Set(await pgrepPids());

    // Launch.
    try {
      const child = spawn('open', ['-nb', bundleId], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      return { ok: false, error: `Failed to launch: ${(err as Error).message}` };
    }

    // Poll for a new pid.
    const start = Date.now();
    while (Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 200));
      const current = await pgrepPids();
      for (const p of current) {
        if (!before.has(p)) {
          launchedApps.set(p, { bundleId, appName, spawnedAt: Date.now() });
          return { ok: true, pid: p, appName, appPath };
        }
      }
    }
    return {
      ok: false,
      error: `Launched ${appName} but no new process appeared within 5s. The app may be a singleton.`,
    };
  });

  ipcMain.handle('app:kill', async (_event, pid: number) => {
    if (typeof pid !== 'number' || !Number.isFinite(pid)) {
      return { ok: false, error: 'pid required' };
    }
    const tracked = launchedApps.get(pid);
    if (!tracked) {
      return { ok: false, error: `Not a tracked launch: ${pid}` };
    }
    try {
      // SIGTERM the process group. The app was launched detached so it
      // has its own process group; killing the group ensures we take
      // down helper processes too.
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Fall back to plain kill if the group doesn't exist
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // ignore — process may already be gone
        }
      }
      // Give it a moment, then SIGKILL stragglers
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      }, 800);
      launchedApps.delete(pid);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // Best-effort attempt to position a spawned app's window inside our
  // Electron window. The macOS helper lives at native/reparent.swift
  // and is run with the Swift interpreter. This is an experiment — if
  // it fails (e.g., Accessibility permission not granted, the spawned
  // app refuses to be moved, or `swift` isn't on PATH), the rest of the
  // App Launcher flow is unaffected and the window streams into the
  // panel as before.
  //
  // We look up the pid from `launchedApps` (populated by app:launch)
  // rather than launching a second instance via the helper — `open -n`
  // would create a duplicate.
  ipcMain.handle(
    'app:reparent',
    async (
      _event,
      args: { bundleId: string; target: { x: number; y: number; width: number; height: number } }
    ) => {
      if (!mainWindow) return { ok: false, error: 'No main window' };
      if (!args?.bundleId || typeof args.bundleId !== 'string') {
        return { ok: false, error: 'bundleId required' };
      }
      const t = args.target;
      if (
        !t ||
        typeof t.x !== 'number' ||
        typeof t.y !== 'number' ||
        typeof t.width !== 'number' ||
        typeof t.height !== 'number'
      ) {
        return { ok: false, error: 'target rect required' };
      }

      // Find the most-recently launched pid for this bundle id. If
      // there are multiple, the latest one is the one we want — the
      // most recent launch.
      let pid: number | null = null;
      let latestSpawnedAt = 0;
      for (const [p, info] of launchedApps.entries()) {
        if (info.bundleId === args.bundleId && info.spawnedAt > latestSpawnedAt) {
          pid = p;
          latestSpawnedAt = info.spawnedAt;
        }
      }
      if (pid === null) {
        return { ok: false, error: `No launched app found for ${args.bundleId}` };
      }

      const scriptPath = path.join(app.getAppPath(), 'native', 'reparent.swift');
      if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: `Helper script not found at ${scriptPath}` };
      }

      const parent = mainWindow.getBounds();
      const argv = [
        scriptPath,
        '--pid',
        String(pid),
        String(parent.x),
        String(parent.y),
        String(parent.width),
        String(parent.height),
        String(t.x),
        String(t.y),
        String(t.width),
        String(t.height),
      ];

      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          const child = spawn('swift', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          let err = '';
          child.stdout.on('data', (c) => (out += c.toString()));
          child.stderr.on('data', (c) => (err += c.toString()));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve(out.trim());
            else reject(new Error(err.trim() || `swift exited ${code}`));
          });
        });
        const m = /^ok\s+(\d+)$/.exec(stdout);
        if (m) {
          return { ok: true, pid: Number(m[1]) };
        }
        return { ok: false, error: `Unexpected helper output: ${stdout}` };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(
    'desktop:capture',
    async (_event, sourceId: string) => {
      // Return a media source handle that the renderer can stream from
      // via getUserMedia. We use the older "chromeMediaSourceId" pattern
      // because Electron's getDisplayMedia is opt-in per session.
      return { sourceId };
    }
  );
}

function applyWindowBackground(mode: 'black' | 'white' | 'system' | 'translucent'): void {
  if (!mainWindow) return;
  if (process.platform === 'darwin' && mode === 'translucent') {
    // Under-window vibrancy on macOS — the desktop / window behind shows
    // through with a subtle blur. The canvas renders transparent over it.
    mainWindow.setBackgroundColor('#00000000');
    mainWindow.setVibrancy('under-window');
  } else if (mode === 'white') {
    mainWindow.setVibrancy(null);
    mainWindow.setBackgroundColor('#ffffff');
  } else if (mode === 'system') {
    // 'system' tracks the OS appearance in the renderer via
    // prefers-color-scheme, so the window itself stays a neutral grey
    // and the canvas swaps between dark/light accordingly.
    mainWindow.setVibrancy(null);
    mainWindow.setBackgroundColor('#1a1a1a');
  } else {
    mainWindow.setVibrancy(null);
    mainWindow.setBackgroundColor('#0f0f0f');
  }
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

  // Allow the renderer to use navigator.mediaDevices.getDisplayMedia.
  // Without this Electron throws "Not supported". When the renderer
  // calls getDisplayMedia, we forward to desktopCapturer and grab the
  // first window source; the App Launcher panel also has a quick-pick UI
  // for choosing a specific window.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      // Exclude our own window and the Electron helper processes.
      const ownPid = process.pid;
      const candidates = sources.filter(
        (s) => !(s as any).pid || (s as any).pid !== ownPid
      );
      const first = candidates[0];
      if (!first) {
        callback({});
        return;
      }
      callback({ video: { id: first.id } as any });
    } catch (err) {
      console.error('[displayMedia] handler failed:', err);
      callback({});
    }
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
  // Kill any apps we launched so we don't leave orphan instances.
  for (const pid of launchedApps.keys()) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
  launchedApps.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
