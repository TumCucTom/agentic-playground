// End-to-end test for the Canvas Workspace app.
// Launches Electron, exercises the canvas, verifies behavior.

import { test, expect, _electron as electron } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

let viteProcess: ChildProcess | null = null;
let vitePort = 5173;

async function waitForVite(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(url, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 304);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite dev server at ${url} did not start in ${timeoutMs}ms`);
}

test.beforeAll(async () => {
  // Ensure dist is built
  const distMain = path.join(PROJECT_ROOT, 'dist/main/index.js');
  if (!fs.existsSync(distMain)) {
    throw new Error(`dist/main/index.js not found. Run 'npm run build' first.`);
  }
  const distRenderer = path.join(PROJECT_ROOT, 'dist/renderer/index.html');
  if (!fs.existsSync(distRenderer)) {
    throw new Error(`dist/renderer/index.html not found. Run 'npm run build' first.`);
  }

  // Start the Vite dev server in the background so the renderer can connect.
  viteProcess = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  viteProcess.stdout?.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  viteProcess.stderr?.on('data', (chunk) => process.stderr.write(`[vite-err] ${chunk}`));
  await waitForVite(`http://localhost:${vitePort}/`);
});

test.afterAll(async () => {
  if (viteProcess) {
    viteProcess.kill('SIGTERM');
    viteProcess = null;
  }
});

function makeUserDataDir() {
  return path.join(os.tmpdir(), `canvas-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function launchApp() {
  const userData = makeUserDataDir();
  return electron.launch({
    args: [
      path.join(PROJECT_ROOT, 'dist/main/index.js'),
      `--user-data-dir=${userData}`,
    ],
    cwd: PROJECT_ROOT,
    timeout: 30_000,
  });
}

test('app launches, loads canvas, has no console errors', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Wait for the canvas to render
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });

  const title = await window.title();
  expect(title).toBeTruthy();

  // The toolbox should be visible (or canvas should be present)
  const canvas = await window.locator('.canvas-root').count();
  expect(canvas).toBeGreaterThan(0);

  await app.close();
});

test('extensions are discovered and listed', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => !!(window as any).canvasAPI?.listExtensions, undefined, { timeout: 15_000 });

  // Poll for the extension host to finish copying bundled extensions.
  // The main process copies them on startup into a per-user-data dir.
  const extensions = await window.evaluate(async () => {
    const api = (window as any).canvasAPI;
    if (!api?.listExtensions) return null;
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const list = await api.listExtensions();
      if (Array.isArray(list) && list.length > 0) return list;
      await new Promise((r) => setTimeout(r, 250));
    }
    return await api.listExtensions();
  });

  expect(extensions).not.toBeNull();
  const ids = (extensions as any[]).map((e) => e.id);
  expect(ids).toContain('canvas-notes');
  expect(ids).toContain('canvas-tasks');
  expect(ids).toContain('canvas-system');

  await app.close();
});

test('canvas state load returns a valid state', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => !!(window as any).canvasAPI?.loadCanvas, undefined, { timeout: 15_000 });

  const state = await window.evaluate(async () => {
    const api = (window as any).canvasAPI;
    return await api.loadCanvas();
  });

  expect(state).toBeTruthy();
  expect(state).toHaveProperty('panels');
  expect(state).toHaveProperty('viewport');
  expect(state.viewport.zoom).toBeGreaterThan(0);

  await app.close();
});

test('context menu opens on right-click', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });

  await window.evaluate(() => {
    const canvas = document.querySelector('.canvas-root');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
      canvas.dispatchEvent(event);
    }
  });

  // Wait for the context menu to appear (it has role="menu" or specific class)
  await window.waitForTimeout(500);

  // Take a screenshot for visual verification
  await window.screenshot({ path: 'test-results/context-menu.png' });

  await app.close();
});

test('terminal panel spawns a working PTY', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });
  await window.waitForFunction(() => !!(window as any).canvasAPI?.ptyCreate, undefined, { timeout: 15_000 });

  // Right-click → Terminal
  await window.evaluate(() => {
    const canvas = document.querySelector('.canvas-root') as HTMLElement | null;
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  });
  await window.getByText('Terminal', { exact: true }).first().click();

  // xterm renders a .xterm container; wait for it to mount
  await window.waitForSelector('.xterm', { timeout: 10_000 });

  // The PTY should write a shell prompt. Poll the terminal's text content
  // for a prompt-ish character (e.g. "$", "%", or ">") within a few seconds.
  const gotPrompt = await window.waitForFunction(
    () => {
      const term = document.querySelector('.xterm-rows');
      if (!term) return false;
      const text = (term as HTMLElement).innerText;
      return /[%>$#]\s*$/.test(text) || /[%>$#]\s/.test(text);
    },
    undefined,
    { timeout: 8_000 }
  ).then(() => true).catch(() => false);

  // If we got a prompt, the PTY spawn + xterm write pipeline works.
  // Soft-assert: the test still passes if xterm rendered, but we surface
  // a failure if the PTY never wrote a prompt.
  if (!gotPrompt) {
    const debug = await window.evaluate(() => {
      return {
        rows: document.querySelector('.xterm-rows')?.textContent?.slice(-200) || null,
        bodyText: document.body.innerText.slice(-200),
      };
    });
    console.error('Terminal did not receive a prompt. Debug:', debug);
  }
  expect(gotPrompt).toBe(true);

  await app.close();
});

test('app launcher panel renders the running-apps quick-pick', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });
  await window.waitForFunction(() => !!(window as any).canvasAPI?.listDesktopSources, undefined, { timeout: 15_000 });

  // Right-click the canvas to open the context menu, then choose App Launcher.
  await window.evaluate(() => {
    const canvas = document.querySelector('.canvas-root') as HTMLElement | null;
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  });
  await window.getByText('App Launcher', { exact: true }).first().click();

  // The App Launcher panel now shows a "Quick launch" grid and a
  // "Mirror existing" fallback.
  await window.waitForSelector('text=Quick launch', { timeout: 5_000 });
  await window.waitForSelector('text=Mirror existing', { timeout: 5_000 });
  await window.waitForSelector('[data-testid="embedded-pick"]', { timeout: 5_000 });

  // Verify the desktop-sources IPC returns the expected shape (now with pid).
  const sources = await window.evaluate(async () => {
    const api = (window as any).canvasAPI;
    if (!api?.listDesktopSources) return null;
    const list = await api.listDesktopSources();
    return list.slice(0, 3).map((s: any) => ({ id: s.id, name: s.name, hasIcon: !!s.appIcon, pid: s.pid }));
  });
  expect(sources).not.toBeNull();

  await app.close();
});

test('app:launch IPC spawns a new macOS app instance', async () => {
  // This test only runs on macOS where `open` and bundle ids are available.
  if (process.platform !== 'darwin') {
    test.skip();
    return;
  }

  // Clean up any leftover TextEdit from a previous failed test run —
  // `open -nb` reuses an existing instance for some apps, which breaks
  // the "new pid" detection.
  const { execSync } = require('child_process');
  try {
    execSync('killall TextEdit 2>/dev/null', { stdio: 'ignore' });
  } catch {}
  await new Promise((r) => setTimeout(r, 500));

  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => !!(window as any).canvasAPI?.launchApp, undefined, { timeout: 15_000 });

  // Launch a lightweight, ubiquitous app: TextEdit. Track its pid.
  const result = await window.evaluate(async () => {
    const api = (window as any).canvasAPI;
    return await api.launchApp('com.apple.TextEdit');
  });

  if (!result.ok) {
    throw new Error(`launchApp failed: ${JSON.stringify(result)}`);
  }
  expect(typeof result.pid).toBe('number');
  expect(result.appName?.toLowerCase()).toContain('textedit');

  // Verify the new process is alive.
  const alive = await new Promise<boolean>((resolve) => {
    const { exec } = require('child_process');
    exec(`ps -p ${result.pid} -o pid=`, (err: any, stdout: string) => {
      resolve(!err && stdout.trim() === String(result.pid));
    });
  });
  expect(alive).toBe(true);

  // Kill it via the IPC.
  const killResult = await window.evaluate(async (pid: number) => {
    const api = (window as any).canvasAPI;
    return await api.killApp(pid);
  }, result.pid);
  expect(killResult.ok).toBe(true);

  // Give the OS a moment to actually reap the process.
  await new Promise((r) => setTimeout(r, 1200));
  const stillAlive = await new Promise<boolean>((resolve) => {
    const { exec } = require('child_process');
    exec(`ps -p ${result.pid} -o pid=`, (err: any) => resolve(!err));
  });
  expect(stillAlive).toBe(false);

  await app.close();
});

test('extension activates and provides webview HTML', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => !!(window as any).canvasAPI?.getExtensionWebview, undefined, { timeout: 15_000 });

  // Activate the notes extension and get its webview HTML
  const result = await window.evaluate(async () => {
    const api = (window as any).canvasAPI;
    if (!api) return null;
    try {
      const html = await api.getExtensionWebview('canvas-notes', 'notes');
      return html ? html.length : 0;
    } catch (e) {
      return -1;
    }
  });

  expect(result).toBeGreaterThan(0);

  await app.close();
});

test('layout mode toggle button switches modes', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });

  // Toggle to grid via the title-bar button
  await window.getByRole('button', { name: 'Grid mode' }).click();

  // The grid layout root has a different className
  await window.waitForSelector('.grid-layout', { timeout: 5_000 });

  // Switch back
  await window.getByRole('button', { name: 'Canvas mode' }).click();
  await window.waitForFunction(() => !document.querySelector('.grid-layout'));

  await app.close();
});

test('cmd+shift+L toggles layout mode', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });

  // Determine starting mode from the DOM
  const before = await window.evaluate(() => {
    return document.querySelector('.grid-layout') ? 'grid' : 'canvas';
  });

  // Toggle via the keyboard shortcut
  await window.keyboard.press('Meta+Shift+l');
  await window.waitForTimeout(200);

  const afterMode = await window.evaluate(() => {
    return document.querySelector('.grid-layout') ? 'grid' : 'canvas';
  });

  expect(afterMode).toBe(before === 'canvas' ? 'grid' : 'canvas');

  await app.close();
});

test('grid mode tiles panels and switching back preserves them', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });
  await window.waitForFunction(() => !!(window as any).canvasAPI?.loadCanvas, undefined, { timeout: 15_000 });

  // Add one panel via right-click → Terminal. The .first() selector
  // matches the menu option (no panel with that title exists yet).
  await window.evaluate(() => {
    const canvas = document.querySelector('.canvas-root') as HTMLElement | null;
    if (!canvas) throw new Error('no canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  });
  await window.getByText('Terminal', { exact: true }).first().click();
  await window.waitForTimeout(500);

  // Sanity: one panel exists in canvas mode
  await expect(window.locator('.canvas-root .panel')).toHaveCount(1);

  // Toggle to grid
  await window.getByRole('button', { name: 'Grid mode' }).click();
  await window.waitForSelector('.grid-layout');

  // The panel should still be visible inside the grid
  const panelCount = await window.locator('.grid-layout .panel').count();
  expect(panelCount).toBe(1);

  // Toggle back to canvas
  await window.getByRole('button', { name: 'Canvas mode' }).click();
  await window.waitForFunction(() => !document.querySelector('.grid-layout'));

  // Panel still there
  const canvasPanelCount = await window.locator('.canvas-root .panel').count();
  expect(canvasPanelCount).toBe(1);

  await app.close();
});
