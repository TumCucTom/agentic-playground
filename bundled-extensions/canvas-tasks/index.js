// Canvas Tasks extension: a Kanban-style task board.
// Demonstrates: webview panel, commands, output channel, status bar, progress.

let tasks = [
  { id: 1, text: 'Set up canvas workspace', status: 'done' },
  { id: 2, text: 'Wire up the extension host', status: 'done' },
  { id: 3, text: 'Build the smart orchestration', status: 'in-progress' },
  { id: 4, text: 'Add marketplace extension adapters', status: 'todo' },
  { id: 5, text: 'Polish the canvas interactions', status: 'todo' },
];

let nextId = 6;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml() {
  const columns = [
    { key: 'todo', label: 'To Do', color: '#888' },
    { key: 'in-progress', label: 'In Progress', color: '#5a9fd4' },
    { key: 'done', label: 'Done', color: '#7ab87a' },
  ];
  return `<!doctype html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; background: #1f1f1f; color: #d0d0d0; margin: 0; padding: 14px; }
  h1 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #5a9fd4; }
  .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .column { background: #181818; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px; min-height: 200px; }
  .column h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px; font-weight: 600; }
  .task { background: #252525; border: 1px solid #2a2a2a; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; cursor: pointer; }
  .task:hover { background: #2a2a2a; border-color: #3a3a3a; }
  .task .id { color: #666; font-family: monospace; font-size: 10px; margin-right: 6px; }
  .task .del { float: right; color: #888; cursor: pointer; padding: 0 4px; }
  .task .del:hover { color: #cc6666; }
  .add { display: flex; gap: 6px; margin-bottom: 12px; }
  .add input { flex: 1; background: #2a2a2a; color: #d0d0d0; border: 1px solid #3a3a3a; padding: 6px 8px; border-radius: 4px; font-size: 12px; }
  .add button { background: #5a9fd4; color: #1a1a1a; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 12px; }
  .stats { font-size: 10px; color: #666; padding: 8px 0 0; }
</style>
</head>
<body>
  <h1>✅ Tasks</h1>
  <div class="add">
    <input id="new-task" placeholder="New task…" />
    <button id="add-btn">Add</button>
  </div>
  <div class="board">
    ${columns
      .map(
        (col) => `
      <div class="column">
        <h2 style="color: ${col.color}">${col.label}</h2>
        ${tasks
          .filter((t) => t.status === col.key)
          .map(
            (t) => `
          <div class="task" data-id="${t.id}">
            <span class="del" data-id="${t.id}" data-action="delete">×</span>
            <span class="id">#${t.id}</span>
            ${escapeHtml(t.text)}
          </div>
        `
          )
          .join('')}
      </div>
    `
      )
      .join('')}
  </div>
  <div class="stats">
    ${tasks.filter((t) => t.status === 'todo').length} todo ·
    ${tasks.filter((t) => t.status === 'in-progress').length} in progress ·
    ${tasks.filter((t) => t.status === 'done').length} done
  </div>
  <script>
    const send = (msg) => {
      try { window.parent.postMessage({ type: 'canvas:webview:message', payload: msg }, '*'); } catch (e) {}
    };
    const input = document.getElementById('new-task');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          send({ kind: 'add', text: input.value.trim() });
          input.value = '';
        }
      });
    }
    const addBtn = document.getElementById('add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (input && input.value.trim()) {
          send({ kind: 'add', text: input.value.trim() });
          input.value = '';
        }
      });
    }
    document.querySelectorAll('.task').forEach((el) => {
      el.addEventListener('click', (e) => {
        const target = e.target;
        if (target && target.dataset && target.dataset.action === 'delete') {
          send({ kind: 'delete', id: parseInt(target.dataset.id) });
          return;
        }
        const id = parseInt(el.dataset.id);
        send({ kind: 'cycle', id });
      });
    });
    send({ kind: 'ready' });
  </script>
</body>
</html>`;
}

function statusKey(t) {
  return t.status;
}

module.exports = function (vscode) {
  const output = vscode.window.createOutputChannel('Canvas Tasks');
  output.appendLine('Canvas Tasks extension activated');

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '$(check) Tasks';
  statusItem.tooltip = `${tasks.length} tasks tracked`;
  statusItem.command = 'canvas-tasks.add';
  statusItem.show();

  const updateStatus = () => {
    const todo = tasks.filter((t) => t.status === 'todo').length;
    const inProgress = tasks.filter((t) => t.status === 'in-progress').length;
    const done = tasks.filter((t) => t.status === 'done').length;
    statusItem.text = `$(check) ${todo}/${tasks.length} todo · ${inProgress} active · ${done} done`;
  };
  updateStatus();

  // Register the webview
  vscode.window.registerWebviewViewProvider('tasks', {
    title: 'Tasks',
    resolveWebviewView(webview) {
      let handler = null;
      const refresh = () => {
        webview.html = renderHtml();
      };
      webview.onDidReceiveMessage((msg) => {
        if (msg.kind === 'ready') {
          refresh();
          return;
        }
        if (msg.kind === 'add') {
          tasks.push({ id: nextId++, text: msg.text, status: 'todo' });
          output.appendLine(`+ Task: ${msg.text}`);
          updateStatus();
          refresh();
        } else if (msg.kind === 'delete') {
          const before = tasks.length;
          tasks = tasks.filter((t) => t.id !== msg.id);
          if (tasks.length < before) {
            output.appendLine(`- Task #${msg.id} deleted`);
            updateStatus();
            refresh();
          }
        } else if (msg.kind === 'cycle') {
          const t = tasks.find((x) => x.id === msg.id);
          if (t) {
            const order = ['todo', 'in-progress', 'done'];
            const i = order.indexOf(t.status);
            t.status = order[(i + 1) % order.length];
            output.appendLine(`→ Task #${t.id} → ${t.status}`);
            updateStatus();
            refresh();
          }
        }
      });
      refresh();
    },
  });

  // Commands
  vscode.commands.registerCommand('canvas-tasks.add', () => {
    vscode.window.showInformationMessage('Use the Tasks panel to add a task.');
  });
  vscode.commands.registerCommand('canvas-tasks.clear', () => {
    const before = tasks.length;
    tasks = tasks.filter((t) => t.status !== 'done');
    const removed = before - tasks.length;
    output.appendLine(`Cleared ${removed} completed tasks`);
    updateStatus();
  });
};
