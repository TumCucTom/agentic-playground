// PTY manager — runs in the main process. Each terminal panel owns a
// pseudo-terminal. Output is forwarded to the renderer over IPC; input
// is sent from the renderer back to the PTY.

import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as os from 'os';
import { taskMonitor } from './taskMonitor.js';

interface PtyProcess {
  id: string;
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (handler: (data: string) => void) => void;
  onExit: (handler: (code: number) => void) => void;
}

class PtyManager {
  private processes = new Map<string, PtyProcess>();
  private nextId = 1;

  async create(opts: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<string> {
    const id = `pty_${this.nextId++}`;
    let ptyMod: any;
    try {
      // node-pty is a native module; require it lazily so the rest of the
      // app can run even if it fails to load.
      ptyMod = require('node-pty');
    } catch (err) {
      throw new Error(
        `node-pty unavailable: ${(err as Error).message}. The terminal panel will not be functional.`
      );
    }
    const shell = opts.shell || (process.env.SHELL as string) || '/bin/zsh';
    const cwd = opts.cwd || os.homedir();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const p = ptyMod.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    const proc: PtyProcess = {
      id,
      pid: p.pid,
      write: (data) => p.write(data),
      resize: (cols, rows) => {
        try {
          p.resize(cols, rows);
        } catch {
          // ignore
        }
      },
      kill: () => {
        try {
          p.kill();
        } catch {
          // ignore
        }
      },
      onData: (handler) => {
        p.onData(handler);
      },
      onExit: (handler) => {
        p.onExit(({ exitCode }: { exitCode: number }) => handler(exitCode));
      },
    };
    this.processes.set(id, proc);
    return id;
  }

  write(id: string, data: string): void {
    const proc = this.processes.get(id);
    if (proc) proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id);
    if (proc) proc.resize(cols, rows);
  }

  kill(id: string): void {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      this.processes.delete(id);
    }
  }

  attach(id: string, window: BrowserWindow, panelId?: string): void {
    const proc = this.processes.get(id);
    if (!proc) return;
    if (panelId) {
      taskMonitor.registerPty(id, panelId);
    }
    proc.onData((data) => {
      // Forward to renderer
      if (!window.isDestroyed()) {
        window.webContents.send('pty:data', { id, data });
      }
      // Feed to task monitor
      taskMonitor.onPtyData(id, data);
    });
    proc.onExit((code) => {
      if (!window.isDestroyed()) {
        window.webContents.send('pty:exit', { id, code });
      }
      taskMonitor.unregisterPty(id);
      this.processes.delete(id);
    });
  }
}

export const ptyManager = new PtyManager();

export function registerPtyHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:create', async (_event: IpcMainInvokeEvent, opts: any) => {
    const id = await ptyManager.create(opts);
    const window = getWindow();
    if (window) ptyManager.attach(id, window, opts?.panelId);
    return { id, pid: -1 };
  });

  ipcMain.handle('pty:write', async (_event: IpcMainInvokeEvent, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.handle('pty:resize', async (_event: IpcMainInvokeEvent, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:kill', async (_event: IpcMainInvokeEvent, id: string) => {
    ptyManager.kill(id);
  });
}
