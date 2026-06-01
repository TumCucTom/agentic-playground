// Sample Canvas Workspace extension: a simple notes panel.
// Demonstrates the extension API surface (commands + webview).

let notes = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(messageHandler) {
  const noteList = notes
    .map(
      (n) =>
        `<li class="note" data-id="${n.id}"><span class="text">${escapeHtml(n.text)}</span><button class="del" data-id="${n.id}">×</button></li>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; background: #1f1f1f; color: #d0d0d0; margin: 0; padding: 14px; }
  h1 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #5a9fd4; }
  .input-row { display: flex; gap: 6px; margin-bottom: 12px; }
  input { flex: 1; background: #2a2a2a; color: #d0d0d0; border: 1px solid #3a3a3a; padding: 6px 8px; border-radius: 4px; font-size: 13px; }
  button.add { background: #5a9fd4; color: #1a1a1a; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: 500; }
  ul { list-style: none; padding: 0; margin: 0; }
  li.note { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
  li.note .text { flex: 1; }
  li.note .del { background: transparent; color: #888; border: none; cursor: pointer; font-size: 16px; padding: 0 4px; }
  li.note .del:hover { color: #cc6666; }
  .empty { color: #666; font-size: 12px; padding: 12px 0; text-align: center; }
</style>
</head>
<body>
  <h1>📝 Notes</h1>
  <div class="input-row">
    <input type="text" id="note-input" placeholder="Type a note and press Enter…" />
    <button class="add" id="add-btn">Add</button>
  </div>
  ${
    notes.length === 0
      ? '<div class="empty">No notes yet.</div>'
      : `<ul id="note-list">${noteList}</ul>`
  }
  <script>
    const send = (msg) => {
      try { window.parent.postMessage({ type: 'canvas:webview:message', payload: msg }, '*'); } catch (e) {}
    };
    const input = document.getElementById('note-input');
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
    document.querySelectorAll('button.del').forEach((btn) => {
      btn.addEventListener('click', () => {
        send({ kind: 'delete', id: btn.dataset.id });
      });
    });
    // Signal ready
    send({ kind: 'ready' });
  </script>
</body>
</html>`;
}

function activate(context) {
  // The activation function gets a context object; we use the vscode shim
  // passed via the default function shape (see extension host).
}

module.exports = function (vscode) {
  // Register a webview view provider for the notes panel
  vscode.window.registerWebviewViewProvider('notes', {
    title: 'Notes',
    resolveWebviewView(webview) {
      const messageHandler = (msg) => {
        // Handle messages from the webview
        if (msg && msg.kind === 'add') {
          notes.push({ id: 'n_' + Math.random().toString(36).slice(2, 9), text: msg.text });
          // Re-render by triggering webviewChanged
          webview.html = renderHtml(() => {});
        } else if (msg && msg.kind === 'delete') {
          notes = notes.filter((n) => n.id !== msg.id);
          webview.html = renderHtml(() => {});
        }
      };
      webview.onDidReceiveMessage(messageHandler);
      webview.html = renderHtml(messageHandler);
    },
  });

  // Register a command that other panels can call
  vscode.commands.registerCommand('canvas-notes.addNote', (text) => {
    if (text) {
      notes.push({ id: 'n_' + Math.random().toString(36).slice(2, 9), text });
    }
  });
};
