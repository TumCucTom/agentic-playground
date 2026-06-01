// TaskMonitor — watches PTY output for patterns that indicate a task
// has finished. When a "done" pattern is detected, emits a taskCompleted
// event to the renderer so the panel can be auto-focused.
//
// Detection patterns:
//   - "Done in X.Xs" / "Build succeeded" (npm/yarn/etc.)
//   - "error:" / "Error:" / "failed with exit code" (build failed)
//   - "$ " / "❯ " (prompt returned, task complete)

import { BrowserWindow } from 'electron';

interface MonitoredPty {
  id: string;
  panelId: string;
  buffer: string;
  lastMatchKind: 'idle' | 'running' | 'done' | 'failed' | null;
  lastMatchAt: number;
}

const DONE_PATTERNS: { re: RegExp; kind: 'done' | 'failed' }[] = [
  // Successful completion
  { re: /\bDone in [\d.]+ ?s/i, kind: 'done' },
  { re: /\bBuild succeeded\b/i, kind: 'done' },
  { re: /\bTest Suites:.*passed\b/i, kind: 'done' },
  { re: /\bAll tests passed\b/i, kind: 'done' },
  { re: /\bCompiled successfully\b/i, kind: 'done' },
  { re: /\bInstallation complete\b/i, kind: 'done' },
  { re: /\b0 vulnerabilities\b/i, kind: 'done' },
  // Failure
  { re: /\bBuild failed\b/i, kind: 'failed' },
  { re: /\bfailed with exit code [^\s]+/i, kind: 'failed' },
  { re: /\bTest Suites:.*failed\b/i, kind: 'failed' },
  { re: /\bCompilation failed\b/i, kind: 'failed' },
  { re: /\b\d+ tests? failed\b/i, kind: 'failed' },
  { re: /\bpanic: /i, kind: 'failed' },
  { re: /\bSegmentation fault\b/i, kind: 'failed' },
  // Prompt returned (most common "task done" indicator)
  { re: /\$\s*$/, kind: 'done' },
  { re: /❯\s*$/, kind: 'done' },
  { re: /➜\s+\S+\s*$/, kind: 'done' },
];

export class TaskMonitor {
  private monitored = new Map<string, MonitoredPty>();
  private getWindow: () => BrowserWindow | null;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  registerPty(ptyId: string, panelId: string): void {
    this.monitored.set(ptyId, {
      id: ptyId,
      panelId,
      buffer: '',
      lastMatchKind: null,
      lastMatchAt: 0,
    });
  }

  unregisterPty(ptyId: string): void {
    this.monitored.delete(ptyId);
  }

  /** Called on every PTY data chunk. */
  onPtyData(ptyId: string, data: string): void {
    const m = this.monitored.get(ptyId);
    if (!m) return;

    // Append to rolling buffer (last 8KB)
    m.buffer = (m.buffer + data).slice(-8192);

    for (const { re, kind } of DONE_PATTERNS) {
      const match = m.buffer.match(re);
      if (match) {
        // Cooldown: don't re-fire for the same kind within 1s
        const now = Date.now();
        if (m.lastMatchKind === kind && now - m.lastMatchAt < 1000) return;
        m.lastMatchKind = kind;
        m.lastMatchAt = now;
        this.emitCompleted(m, kind);
        return;
      }
    }
  }

  private emitCompleted(m: MonitoredPty, kind: 'done' | 'failed'): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send('task:completed', {
      panelId: m.panelId,
      ptyId: m.id,
      kind,
    });
  }
}

export const taskMonitor = new TaskMonitor(() => mainWindowSingleton);
let mainWindowSingleton: BrowserWindow | null = null;
export function setTaskMonitorWindow(w: BrowserWindow | null): void {
  mainWindowSingleton = w;
}
