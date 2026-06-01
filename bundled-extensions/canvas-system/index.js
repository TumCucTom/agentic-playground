// Canvas System extension: shows live system info and demonstrates
// progress + workspace.fs + Uri + EventEmitter APIs.

const os = require('os');
const fs = require('fs');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSystemInfo() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpus: cpus.length,
    model: cpus[0]?.model || 'unknown',
    hostname: os.hostname(),
    release: os.release(),
    totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
    freeMem: (freeMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
    usedPct: (((totalMem - freeMem) / totalMem) * 100).toFixed(1) + '%',
    uptime: (os.uptime() / 3600).toFixed(1) + ' hours',
    nodeVersion: process.version,
    shell: os.userInfo().shell,
    user: os.userInfo().username,
    home: os.homedir(),
    cwd: process.cwd(),
  };
}

function renderHtml(info) {
  return `<!doctype html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; background: #1f1f1f; color: #d0d0d0; margin: 0; padding: 14px; font-size: 12px; }
  h1 { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: #5a9fd4; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  .key { color: #888; font-size: 11px; }
  .val { color: #d0d0d0; font-family: "SF Mono", Menlo, monospace; font-size: 11px; }
  .section { margin-top: 14px; padding-top: 10px; border-top: 1px solid #2a2a2a; }
  .section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px; color: #5a9fd4; }
  button { background: #5a9fd4; color: #1a1a1a; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 12px; margin-right: 6px; }
  button.secondary { background: #3a3a3a; color: #d0d0d0; }
  .actions { margin-top: 10px; }
  pre { background: #181818; padding: 8px; border-radius: 4px; font-size: 11px; overflow: auto; max-height: 100px; }
</style>
</head>
<body>
  <h1>📊 System Info</h1>
  <div class="grid">
    <div class="key">Platform</div><div class="val">${escapeHtml(info.platform)}</div>
    <div class="key">Arch</div><div class="val">${escapeHtml(info.arch)}</div>
    <div class="key">Hostname</div><div class="val">${escapeHtml(info.hostname)}</div>
    <div class="key">User</div><div class="val">${escapeHtml(info.user)}</div>
    <div class="key">Node</div><div class="val">${escapeHtml(info.nodeVersion)}</div>
    <div class="key">CPUs</div><div class="val">${info.cpus} × ${escapeHtml(info.model)}</div>
    <div class="key">Memory</div><div class="val">${escapeHtml(info.freeMem)} free of ${escapeHtml(info.totalMem)} (${escapeHtml(info.usedPct)} used)</div>
    <div class="key">Uptime</div><div class="val">${escapeHtml(info.uptime)}</div>
    <div class="key">Shell</div><div class="val">${escapeHtml(info.shell)}</div>
    <div class="key">Home</div><div class="val">${escapeHtml(info.home)}</div>
    <div class="key">CWD</div><div class="val">${escapeHtml(info.cwd)}</div>
  </div>
  <div class="section">
    <h2>Workspace Demo</h2>
    <div class="actions">
      <button id="refresh-btn">Refresh</button>
      <button id="run-demo-btn" class="secondary">Run Progress Demo</button>
    </div>
    <pre id="log">Ready.</pre>
  </div>
  <script>
    const send = (msg) => {
      try { window.parent.postMessage({ type: 'canvas:webview:message', payload: msg }, '*'); } catch (e) {}
    };
    const log = (text) => {
      const el = document.getElementById('log');
      if (el) {
        el.textContent = (text + '\\n' + el.textContent).split('\\n').slice(0, 8).join('\\n');
      }
    };
    document.getElementById('refresh-btn')?.addEventListener('click', () => send({ kind: 'refresh' }));
    document.getElementById('run-demo-btn')?.addEventListener('click', () => send({ kind: 'runDemo' }));
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg && msg.kind === 'log') log(msg.text);
    });
    send({ kind: 'ready' });
  </script>
</body>
</html>`;
}

module.exports = function (vscode) {
  const output = vscode.window.createOutputChannel('Canvas System');
  output.appendLine('Canvas System extension activated');

  let cachedInfo = getSystemInfo();
  let webviewRef = null;

  vscode.window.registerWebviewViewProvider('system', {
    title: 'System Info',
    resolveWebviewView(webview) {
      webviewRef = webview;
      const refresh = () => {
        webview.html = renderHtml(cachedInfo);
      };
      webview.onDidReceiveMessage(async (msg) => {
        if (msg.kind === 'ready') {
          refresh();
          return;
        }
        if (msg.kind === 'refresh') {
          cachedInfo = getSystemInfo();
          output.appendLine('System info refreshed');
          refresh();
        } else if (msg.kind === 'runDemo') {
          // Exercise withProgress
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: 'Canvas System: running demo',
            },
            async (progress) => {
              for (let i = 1; i <= 5; i++) {
                await new Promise((r) => setTimeout(r, 200));
                progress.report({ message: `Step ${i}/5`, increment: 20 });
                output.appendLine(`Demo step ${i}/5`);
              }
              return 'done';
            }
          );
          output.appendLine('Demo complete');
        }
      });
      refresh();
    },
  });

  vscode.commands.registerCommand('canvas-system.refresh', () => {
    cachedInfo = getSystemInfo();
    output.appendLine('Refresh command invoked');
  });
  vscode.commands.registerCommand('canvas-system.runDemo', () => {
    output.appendLine('RunDemo command invoked');
  });
};
