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
  explorer, markdown viewer, webview, app launcher, and arbitrary
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
- **Two layout modes per workspace:** infinite **Canvas** (with magnetic
  snap while dragging) and VS Code-style tiled **Grid**. Toggle with
  `⌘⇧L` or the segmented control in the title bar. Mode state is
  preserved per workspace and survives the switch.
- **App Launcher:** the left sidebar has one-click icons for
  common apps (Chrome, VS Code, Terminal, Safari, Finder by
  default). Click spawns a *new instance* of the app and streams
  its window into a new App Launcher panel. Right-click an icon
  to remove it, add a custom bundle id, or restore the defaults.
  The full App Launcher panel also has a quick-launch grid and a
  "Capture existing" fallback (VS Code, Chrome, Terminal, Safari,
  etc.) that lets you mirror a window that's already open. The
  spawned process is killed when the panel closes, and the system
  picker (`getDisplayMedia`) handles anything else. The stream is
  one-way — input still goes to the real app.
  - **In-canvas positioning (experimental):** the App Launcher's
    panel settings include a "Position window inside canvas"
    toggle. When on, the main process runs `native/reparent.swift`
    after launch — a Swift helper that uses the macOS accessibility
    API to move the spawned app's window on top of the panel
    (rather than at its default desktop position). Requires
    Accessibility permission; the launch flow falls back gracefully
    if the helper fails. A "snap" button in the streaming view
    re-positions on demand.
- **File browser & editor wired to the real filesystem** through IPC.

## Layout modes

Two modes per workspace, toggled from the title bar or with `⌘⇧L`:

- **Canvas** (default) — infinite pan/zoom canvas. Drag a panel near
  another panel's edge or the viewport edge to snap into alignment;
  a thin purple guide line shows the snap target. Hold `⌘` while
  dragging to disable snapping for one drag.
- **Grid** — VS Code-style binary-split tiling. Panels fill the
  viewport with no overlap and no gaps.
  - `⌘\` splits the focused panel right
  - `⌘-` splits the focused panel down
  - `⌘W` closes the focused panel (sibling absorbs its space)
  - Drag a divider to resize both neighbours

Switching modes preserves panel identity, so PTYs keep running,
editors keep their buffers, and webviews keep their pages. Geometry
reflows.

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

> **Marketplace extensions are not supported.** The shim implements a
> useful subset of the `vscode` API for our three bundled extensions
> (commands, window messages, webviews, status bar, output channels,
> progress, tree views, workspace.fs, Uri, EventEmitter, env, config),
> but there is no `.vsix` install path, no marketplace contract, no
> activation events, no `ExtensionContext`-based storage, and no
> language-server or debug-adapter plumbing. Running a real extension
> would need both shim work and a host-of-hosts layer. See
> `src/extensionHost/api.ts` for the actual surface.

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
  e2e/                 playwright electron end-to-end tests (8 tests)
```

## Tests

```bash
npm test           # 67 unit tests (vitest)
npm run test:e2e   # 11 end-to-end tests (playwright + electron)
```

The E2E suite launches the actual app via `_electron` from Playwright,
waits for the Vite dev server, and exercises the canvas, the
extension host, and IPC. Each test gets its own temp `user-data-dir` so
they don't share state.

## Keyboard shortcuts

| Shortcut              | Action                                    |
| --------------------- | ----------------------------------------- |
| Cmd+scroll            | Zoom canvas                               |
| Scroll                | Pan canvas                                |
| Right-click           | Open add-panel menu                       |
| Cmd+0                 | Reset view                                |
| Cmd++ / Cmd+-         | Zoom in / out                             |
| Cmd+S                 | Force save                                |
| Cmd+Z                 | Undo                                      |
| Cmd+Shift+Z / Y       | Redo                                      |
| Cmd+Shift+L           | Toggle layout mode (canvas / grid)        |
| Cmd (held)            | Disable snap while dragging (canvas mode) |
| Cmd+\                 | Split right (grid mode)                   |
| Cmd+-                 | Split down (grid mode) / Zoom out (canvas)|
| Cmd+W                 | Close focused panel (grid mode)           |

## Honest limitations

- **App Launcher is a screen mirror of a spawned process**, not real
  window reparenting. macOS does not allow reparenting another app's
  window into a non-native view. The launcher spawns a *new* instance
  of the app (`open -nb <bundle>`) and streams its window — the
  spawned process is fully isolated and gets its own user-data dir
  per panel. Clicks and keystrokes still go to the real app.
- **Marketplace extensions are not supported.** Only the three bundled
  extensions can run. See [Extensions](#extensions) for what would be
  needed to host real `.vsix` packages.
- **Terminal state is not persisted** across app restarts. Each launch
  is a fresh shell.

## License

MIT.
