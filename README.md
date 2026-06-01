# Canvas Workspace

An infinite-canvas macOS desktop app that hosts VS Code–style panels, real
terminals, file explorers, and embedded apps. Built on Electron with a
VS Code–shaped extension host so existing extension patterns can be reused.

> **Heads up:** this is a working prototype, not a packaged VS Code. The
> bundled extensions are first-class, but real marketplace extensions need
> per-extension shim work because the `vscode` API surface is intentionally
> partial. See [Extensions](#extensions) below.

## Features

- **Infinite canvas** with Cmd+scroll to zoom, scroll to pan, right-click
  for the add-panel menu, Cmd+0 to fit.
- **Panels** as flat rectangles you can drag, resize, focus, and close.
  Title bar shows a state indicator dot for terminal-style panels.
- **Built-in panel types:** terminal (real PTY), editor (Monaco), file
  explorer, markdown viewer, webview, embedded app mirror, and arbitrary
  extensions.
- **Extension host** spawned as a child process with newline-delimited
  JSON-RPC. Three bundled extensions: `canvas-notes`, `canvas-tasks`
  (Kanban with status bar), `canvas-system` (system info with progress
  demo + `workspace.fs` + `Uri`).
- **Real PTY** terminal (node-pty + xterm.js). Multi-instance, hot key
  respawns, etc.
- **Smart terminal orchestration:** a `TaskMonitor` watches every PTY's
  rolling output buffer for "Done in …s", "Build succeeded/failed",
  prompt returns, etc. On completion the affected panel is auto-focused
  and auto-promoted. The "1 Big + N Small" toolbar button re-lays out
  terminal panels so the focused one is large and the rest are small.
- **Undo / redo** with a 100 ms coalescing window so a drag is one
  undo step. Cmd+Z / Cmd+Shift+Z.
- **Multi-workspace:** each workspace is its own JSON file under
  `~/Library/Application Support/canvas-workspace/workspaces`. Quick
  switcher in the toolbar.
- **Auto-save** every 500 ms; Cmd+S to force a save.
- **App Mirror:** capture a window from any other app and display it
  inside a panel via `getDisplayMedia`. One-way mirror — input still
  goes to the real app.
- **File browser & editor wired to the real filesystem** through IPC.

## Running it

```bash
npm install
npm run dev          # vite + tsc-watch + electron, hot reload
```

That runs Vite, the main-process TypeScript compiler, the preload
TypeScript compiler, and Electron, all under `concurrently`. The window
connects to Vite at `http://localhost:5173`.

To run a one-shot build (renderer bundled, main+preload compiled):

```bash
npm run build
npm start
```

## Packaging a `.app` bundle

```bash
npm run package:mac
```

Produces `release/CanvasWorkspace-darwin-arm64/CanvasWorkspace.app`.
Double-click to launch. Currently arm64-only; add `--arch=x64` for
Intel Macs.

## Architecture

Three processes, same as VS Code:

```
┌──────────────┐  IPC (contextBridge)  ┌──────────────┐  stdio JSON-RPC  ┌──────────────────┐
│   Renderer   │ ←──────────────────→  │  Main (Node) │ ←──────────────→ │ Extension Host   │
│  React+Zustand│                      │  Electron +  │                  │  (sandboxed JS)  │
│              │                      │  PTY/IPC     │                  │                  │
└──────────────┘                      └──────────────┘                  └──────────────────┘
```

- **Renderer** — React + TypeScript + Zustand. Holds canvas state with
  undo/redo history, panel layout, focus/selection. Talks to main via
  the `canvasAPI` exposed through `preload/index.ts`.
- **Main** — Electron `BrowserWindow`, IPC handlers, `node-pty`
  manager, `TaskMonitor` watching terminal output, JSON-RPC broker to
  the extension host. Spawns the extension host on `app.whenReady`.
- **Extension host** — child Node process. Loads extension manifests
  from the user-data extensions dir, `require`s the entry, builds a
  vscode-shaped shim, and routes calls. The shim is intentionally
  partial — see `src/extensionHost/api.ts`.

The bundled extensions are copied from `bundled-extensions/` into the
user's `extensions` dir on first launch. In a packaged build they live
under `CanvasWorkspace.app/Contents/Resources/app/bundled-extensions/`.

## Extensions

Bundled:

- **`canvas-notes`** — minimal notes app using `registerWebviewViewProvider`.
- **`canvas-tasks`** — Kanban board with task cycling, add/delete,
  status bar counter. Demonstrates `createStatusBarItem`,
  `createOutputChannel`, and webview round-tripping.
- **`canvas-system`** — system info panel that exercises
  `vscode.window.withProgress` (5-step demo with progress reporting),
  `workspace.fs`, and `Uri`.

Adding a new bundled extension:

1. Create `bundled-extensions/<id>/` with a `package.json` and `index.js`.
2. Declare `main`, `contributes.webviews[]`, and `contributes.commands[]`.
3. The extension's `module.exports = function(vscode) { ... }` runs on
   activation. Use `vscode.window.registerWebviewViewProvider('viewId', { ... })`.

Marketplace extensions need additional shim work — the `vscode` API
surface we implement is intentionally partial. See
`src/extensionHost/api.ts` for what's there.

## Project layout

```
src/
  main/                Electron main process
    index.ts           entry, IPC handlers, app lifecycle
    extensionHostManager.ts  RPC broker to extension host
    ptyManager.ts      node-pty wrapper
    taskMonitor.ts     pattern-matching on PTY output
  preload/
    index.ts           contextBridge → window.canvasAPI
  renderer/            React + Zustand UI
    App.tsx            top-level, auto-save, workspace switcher
    Canvas.tsx         infinite canvas, pan/zoom, context menu
    Panel.tsx          panel chrome (drag, resize, focus, close)
    LayoutToolbar.tsx  workspace switcher + 1+N layout button
    panels/            one file per panel type
  extensionHost/       child-process extension runtime
    index.ts           JSON-RPC stdio server
    api.ts             vscode-shaped shim + registry
    protocol.ts        request/response/event types
  shared/              types shared across all three processes

bundled-extensions/    extensions shipped with the app
docs/superpowers/specs design spec
tests/
  unit/                vitest unit tests (32 tests)
  e2e/                 playwright electron end-to-end tests
```

## Tests

```bash
npm test           # 32 unit tests (vitest)
npm run test:e2e   # 5 end-to-end tests (playwright + electron)
```

The E2E suite launches the actual app via `_electron` from Playwright,
waits for the Vite dev server, and exercises the canvas, the
extension host, and IPC. Each test gets its own temp `user-data-dir` so
they don't share state.

## Keyboard shortcuts

| Shortcut         | Action                              |
| ---------------- | ----------------------------------- |
| Cmd+scroll       | Zoom canvas                         |
| Scroll           | Pan canvas                          |
| Right-click      | Open add-panel menu                 |
| Cmd+0            | Reset view                          |
| Cmd++ / Cmd+-    | Zoom in / out                       |
| Cmd+S            | Force save                          |
| Cmd+Z            | Undo                                |
| Cmd+Shift+Z / Y  | Redo                                |

## Honest limitations

- **App embedding is a one-way screen mirror**, not real window
  reparenting. macOS does not allow reparenting another app's window
  into a non-native view. Interact with the source app directly.
- **Real marketplace extensions are not yet supported** — only the
  bundled three. The shim implements a useful subset of the `vscode`
  API; running an arbitrary marketplace extension would need per-
  extension shimming.
- **The Terminal panel is real PTY**, but terminal state is not
  persisted across app restarts. Each launch is a fresh shell.

## License

MIT.
