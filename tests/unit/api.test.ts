import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionRegistry, buildVSCodeShim } from '../../src/extensionHost/api';

describe('vscode shim', () => {
  let sendEvent: any;
  let registry: ExtensionRegistry;
  let vscode: any;

  beforeEach(() => {
    sendEvent = vi.fn();
    registry = new ExtensionRegistry(sendEvent);
    vscode = buildVSCodeShim('test-ext', registry);
  });

  it('exposes Uri class with file/parse', () => {
    const u = vscode.Uri.file('/foo/bar.txt');
    expect(u.scheme).toBe('file');
    expect(u.fsPath).toBe('/foo/bar.txt');
    expect(u.toString()).toBe('file:///foo/bar.txt');

    const parsed = vscode.Uri.parse('file:///x/y');
    expect(parsed.scheme).toBe('file');
    expect(parsed.path).toBe('/x/y');
  });

  it('exposes ViewColumn and ProgressLocation enums', () => {
    expect(vscode.ViewColumn.One).toBe(1);
    expect(vscode.ProgressLocation.Window).toBe(10);
  });

  it('registers a command and executes it', async () => {
    const handler = vi.fn(() => 'ok');
    vscode.commands.registerCommand('hello', handler);
    const result = await vscode.commands.executeCommand('hello', 'arg1', 2);
    expect(handler).toHaveBeenCalledWith('arg1', 2);
    expect(result).toBe('ok');
  });

  it('rejects unknown command execution', async () => {
    await expect(vscode.commands.executeCommand('nope')).rejects.toThrow(/not found/);
  });

  it('creates a status bar item with defaults', () => {
    const item = vscode.window.createStatusBarItem();
    expect(item.alignment).toBe('left');
    expect(item.priority).toBe(0);
    expect(typeof item.show).toBe('function');
  });

  it('creates an output channel and appends', () => {
    const ch = vscode.window.createOutputChannel('test');
    ch.appendLine('hello');
    ch.append('world');
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'log', message: expect.stringContaining('hello') })
    );
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'log', message: expect.stringContaining('world') })
    );
  });

  it('shows messages of different severities', () => {
    vscode.window.showInformationMessage('info');
    vscode.window.showWarningMessage('warn');
    vscode.window.showErrorMessage('err');
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('runs withProgress and reports progress', async () => {
    const result = await vscode.window.withProgress({ location: 10 }, async (progress) => {
      progress.report({ message: 'halfway', increment: 50 });
      return 'done';
    });
    expect(result).toBe('done');
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('halfway') })
    );
  });

  it('exposes workspace.fs for real file operations', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmp = path.join(os.tmpdir(), 'canvas-shim-test-' + Date.now() + '.txt');
    try {
      const u = vscode.Uri.file(tmp);
      await vscode.workspace.fs.writeFile(u, new Uint8Array(Buffer.from('hello')));
      const stat = await vscode.workspace.fs.stat(u);
      expect(stat.size).toBe(5);
      const data = await vscode.workspace.fs.readFile(u);
      expect(Buffer.from(data).toString()).toBe('hello');
      expect(await vscode.workspace.fs.exists(u)).toBe(true);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  it('reads configuration', () => {
    registry.setConfig('test-ext', 'mySection.key', 'value');
    const cfg = vscode.workspace.getConfiguration('mySection');
    expect(cfg.get('key')).toBe('value');
    expect(cfg.get('missing', 'default')).toBe('default');
  });

  it('exposes EventEmitter with subscribe/unsubscribe', () => {
    const ee = new vscode.EventEmitter<string>();
    const listener = vi.fn();
    const sub = ee.event(listener);
    ee.fire('hello');
    expect(listener).toHaveBeenCalledWith('hello');
    sub.dispose();
    ee.fire('world');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registers a webview view provider', () => {
    vscode.window.registerWebviewViewProvider('myview', {
      title: 'My View',
      resolveWebviewView: (webview) => {
        webview.html = '<html><body>hi</body></html>';
      },
    });
    const api = registry.getAPI('test-ext');
    expect(api?.webviewProviders).toHaveLength(1);
    expect(api?.webviewProviders[0].viewId).toBe('myview');
  });

  it('creates a tree view with a data provider', () => {
    const provider = {
      getTreeItem: (el: any) => ({ label: el.label }),
      getChildren: () => Promise.resolve([{ label: 'a' }, { label: 'b' }]),
    };
    vscode.createTreeView('mytree', { treeDataProvider: provider });
    const api = registry.getAPI('test-ext');
    expect(api?.treeViewProviders).toHaveLength(1);
  });

  it('exposes env with shell and app info', () => {
    expect(typeof vscode.env.appName).toBe('string');
    expect(vscode.env.shell).toBeTruthy();
  });
});
