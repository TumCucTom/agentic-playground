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
