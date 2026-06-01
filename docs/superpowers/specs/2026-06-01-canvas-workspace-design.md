# Canvas Workspace — Design Spec

**Date:** 2026-06-01
**Status:** Approved (pending user review)
**Author:** Thomas Bale + Zippy AI

## Vision

A macOS desktop application that provides an infinite, zoomable canvas for organizing development work. The canvas hosts rectangular "panels" that can be:

1. Built-in panels (terminal, file explorer, editor, webview, markdown preview)
2. VS Code extension panels (loaded from marketplace extensions, rendered via a built-in extension host)
3. (Phase 2) Embedded real macOS apps (Chrome, VS Code instances)
4. (Phase 3) Smart task orchestration with automatic panel switching

The spatial canvas replaces tab-switching with direct spatial navigation. VS Code extensions are first-class citizens — anything you can run in VS Code's sidebar or as a webview, you can place on the canvas.

## Architecture

### Tech Stack: Electron

VS Code is built on Electron. The extension host protocol, webview system, and multi-process architecture map directly to our needs. We work in the same medium as VS Code with the same primitives.

Other options considered and rejected:
- **Tauri** — too constrained for hosting full VS Code extension processes and webviews
- **Native Swift** — would require reimplementing the webview + extension host stack

### Process Model

Three processes, communicating via IPC and RPC:

1. **Main process** — Electron's main. Owns window lifecycle, manages the extension host process, handles macOS-specific integrations. Persists canvas state to disk.

2. **Renderer process** — The canvas UI. Renders the infinite canvas, panels, toolbox sidebar, and context menu. Receives messages from main for extension host events and panel lifecycle.

3. **Extension host process** — A separate Node.js process implementing the VS Code extension API. Loads extensions, runs them in their own VMs, mediates communication to/from the renderer via RPC. This is the same architecture VS Code uses — we get isolation, security, and crash recovery for free.

### Communication

- Main ↔ Renderer: Electron IPC
- Main ↔ Extension Host: Node.js child process + JSON-RPC (same protocol VS Code uses)
- Renderer ↔ Extension Host: mediated via main (webview messages are proxied through main for security)

## Canvas System

### Coordinate System

- Logical canvas coordinates: floating point, unbounded
- Origin (0,0) is the center of the user's working area at app start
- All panel positions and sizes are stored in canvas coordinates
- The viewport is a window into the canvas — pan and zoom transform between viewport pixels and canvas coordinates

### Rendering

- HTML/CSS with `transform: translate()` for panels (not a single `<canvas>` element)
- Each panel is a positioned DOM element with embedded `<webview>` or `<iframe>` for content
- Native browser accessibility (screen readers, keyboard nav) comes for free
- DOM handles 50-100 panels without performance issues
- A WebGL-rendered minimap can be added later if needed

### Pan and Zoom

- **Pan:** trackpad scroll, or hold space + drag, or middle-mouse drag
- **Zoom:** Cmd+scroll (trackpad pinch), Cmd+/Cmd-, or Cmd+0 to fit all panels
- **Zoom range:** 0.1x to 4x

### Selection and Focus

- Click a panel to focus (raise z-order, give input focus)
- Hover highlights panel edges
- Empty canvas click deselects all
- Cmd+A selects all panels
- Esc deselects
- Delete removes selected panel(s)

### Persistence

- Canvas state (panel positions, sizes, content references, zoom level, viewport position) saved to JSON in app data directory
- Auto-save on every change (debounced 500ms)
- Cmd+S forces save
- Cmd+Z / Cmd+Shift+Z undo/redo
- "Workspaces" — named canvas layouts switchable via Cmd+1, Cmd+2, etc.

## Panel System

### Data Model

```
Panel {
  id: string (UUID)
  type: 'terminal' | 'fileExplorer' | 'editor' | 'webview' | 'markdownPreview' | 'extension' | 'embedded'
  position: { x, y } in canvas coordinates
  size: { width, height } in canvas units
  title: string
  contentRef: reference to content (terminal id, extension id, webview URL, etc.)
  state: 'idle' | 'running'
  zOrder: number
}
```

### Built-in Panel Types

- **Terminal** — PTY-backed terminal (xterm.js renderer, node-pty backend). Real shell. Resize, copy/paste, scrollback, search.
- **File Explorer** — Tree view of a directory. Click files to open in editor.
- **Editor** — Monaco editor (same editor VS Code uses). Tabs for multiple files.
- **Webview** — Panel displaying a URL or HTML. Used for scratch content and as the rendering surface for VS Code extension webviews.
- **Markdown Preview** — Renders markdown with live reload.

### Panel Lifecycle

- **Created:** via toolbox, context menu, or command palette. Default size 400x300, placed at viewport center.
- **Moved:** drag title bar. Snap-to-grid optional (16px or 32px).
- **Resized:** drag bottom-right handle. Shift to maintain aspect ratio. Alt to resize from center.
- **Closed:** click X in title bar, or select + Delete.
- **Restored:** closed panels can be reopened from a "history" view (Cmd+Shift+H).

### Panel Grouping (Phase 1.5)

- Multi-select with Shift+click or selection rectangle
- Group selected panels to move/resize together
- Cmd+Shift+G to ungroup

### Extension Panels

- A panel whose `type` is `extension` is rendered by a VS Code extension running in the extension host
- Extension provides a webview (HTML/JS/CSS) rendered in a sandboxed iframe
- Communication via standard VS Code webview messaging API (`postMessage`)
- Examples: GitLens, Database Client, Project Manager

### Adding Panels

- **Toolbox sidebar** — persistent toolbar on left edge with draggable panel icons
- **Right-click context menu** — right-click on canvas to get a menu of available panels
- **Command palette** (Phase 1.5) — Cmd+K global search palette

### State Management

- Panels are managed as a flat list in canvas state
- Observer pattern: when panel state changes, only the affected panel re-renders
- "Dirty" flag on canvas state triggers debounced save

## Extension Host (VS Code Compatible)

### Required API Surface (Phase 1)

- `vscode.window` — `createWebviewPanel()`, `showInformationMessage()`, `registerWebviewViewProvider()`
- `vscode.workspace` — `workspaceFolders`, `getConfiguration()`, `onDidChangeConfiguration`, file system access
- `vscode.commands` — `registerCommand()`, `executeCommand()`
- `vscode.ExtensionContext` — subscriptions, globalState, workspaceState
- `vscode.ViewColumn` — enum for panel placement
- `vscode.Webview` — HTML content, message passing, options
- `vscode.WebviewView` API — for sidebar-style panels

### Out of Scope (Phase 1)

- Language Server Protocol (LSP) extensions
- Debug Adapter Protocol (DAP) extensions
- Terminal-related extensions that shell into VS Code's integrated terminal
- Themes and color customization

### Loading Extensions

- **Bundled** — a `extensions/` directory containing pre-installed extensions
- **Local path** — load a `.vsix` file (Phase 1.5)

### Lifecycle

- Extension host is a separate Node.js process spawned by main on app start
- Extensions activate lazily when first requested
- If an extension crashes, the host restarts and re-activates the failed extension
- Extensions cannot access the filesystem outside their declared scope; all access is mediated

### Communication Flow (Webview Example)

1. User adds a "Database Client" panel from the toolbox
2. Main asks extension host to activate the extension
3. Extension host loads the extension, which calls `vscode.window.registerWebviewViewProvider()`
4. Extension host notifies main: "this extension provides a sidebar view"
5. Main notifies renderer: "new panel available of type 'Database Client'"
6. Renderer creates a panel with type `extension`, contentRef `{ extensionId: 'database-client', viewId: 'connections' }`
7. When the panel renders, renderer requests webview HTML from extension host
8. Extension host asks extension for HTML; extension returns HTML + message handler
9. Renderer creates a sandboxed iframe with the HTML; postMessage routes through the host
10. User clicks "Connect" in the webview; message → renderer → main → extension host → extension code

### Target Extensions for Phase 1 Testing

- **GitLens** — webview panels for git history, file annotations
- **Database Client** — webview panels for database queries
- **Project Manager** — sidebar webview for project list
- **Markdown Preview Enhanced** — webview-based markdown rendering

## Smart Terminal Orchestration

### Task States

Two states per panel:
- **Running** — actively processing
- **Idle** — not processing

The "Done" event is the *transition* from Running to Idle, not a separate state. TaskMonitor watches transitions, not steady states.

Transitions:
- Idle → Running: `taskStarted` event
- Running → Idle: `taskCompleted` event

Transition triggers:
1. Auto-focus the panel (if enabled per workspace)
2. Notify (sound, dock badge, in-canvas indicator)

### Detection Modes

1. **Semantic detection (passive, automatic):**
   - Terminal: regex patterns for prompt return (`$ `, `❯ `, `[user@host ~]$ `), build done (`Done in X.Xs`, `Build succeeded`), build failed (`error:`, `failed with exit code`)
   - Webview extensions: explicit "task complete" messages via a `canvas.reportTaskState` API
   - Editor: file save events mark panel as Idle

2. **Explicit task markers (active, user-set):**
   - Cmd+R when panel focused: declare task starting
   - Cmd+Shift+R: declare task complete
   - Extensions: `vscode.commands.executeCommand('canvas.markRunning')` and `canvas.markIdle()`

### Configuration

Per-workspace:
- "Auto-focus on task completed" toggle
- "Notification sound" toggle
- "Global hotkey to cycle to next running panel" toggle

### View Mode: 1 Big + N Small

A panel layout preset: select multiple terminals, choose "View → 1 Big + N Small" or use keyboard shortcut. Big terminal is the focused one; small terminals are minimizable previews.

### Implementation

- TaskMonitor in the main process observes all panels
- Terminal output captured via node-pty data events; analyzed by TaskMonitor
- Extensions report task state via IPC messages to main
- Renderer subscribes to task state changes; focused panel re-renders with task-state indicator (colored border, badge)
- When auto-focus triggers, panel's zOrder is raised and it scrolls into view if off-screen

### Edge Cases

- Multiple panels become Idle simultaneously: notify all, focus the most recently created
- No panel has become Idle but user is waiting: show "All Running" indicator
- User is actively typing in a panel that just became Idle: don't auto-focus; user has reclaimed attention

## Phasing

### Phase 1: Canvas + Panels + Extension Host (MVP)

- Infinite canvas with pan/zoom
- Terminal, file explorer, editor, webview, markdown preview panels
- Toolbox sidebar + right-click context menu
- Built-in extension host compatible with VS Code's webview API
- 3+ bundled VS Code extensions working as panels
- Save/load canvas layouts as workspaces
- Basic Running/Idle state with manual markers

### Phase 2: App Embedding

- Embed real macOS apps (Chrome, VS Code instances) as panels
- Use macOS Accessibility API + window redirection
- Requires accessibility permissions

### Phase 3: Smart Orchestration

- Full semantic detection
- 1 Big + N Small view mode
- Per-workspace rules

### Phase 4: Polish

- Themes
- Custom panels
- Multi-workspace sync
- Performance optimization for hundreds of panels

## Testing Strategy

- **Unit tests** for canvas math (coordinate transforms, hit testing, snap-to-grid)
- **Integration tests** for the extension host (load known extension, verify activation and command registration)
- **Visual tests** for the canvas rendering (Playwright, golden images)
- **Manual testing** for canvas interactions (zoom, pan, drag, resize) — best evaluated by a human
- **Extension smoke tests** for each target extension (GitLens, Database Client, etc.) — load and verify webview panel renders and responds to messages

### What I Can Test

I can run unit tests, integration tests, and build the app. I cannot do visual quality testing of the rendered canvas (need to see it). Same for the "feel" of canvas interactions.

## Design Decisions

### Why Flat Rectangles

Panels are flat rectangles (not tilted cards or glassmorphic). Simpler to implement, easier to host VS Code extensions without visual distortion, and maps directly to how VS Code's own panels work.

### Why HTML/CSS for Panels

Not a single `<canvas>` element. Each panel is a positioned DOM element with embedded webview. Easier webview integration, native browser accessibility, sufficient performance for typical use.

### Why Electron

Same medium as VS Code. Extension host protocol, webview system, and multi-process architecture all map directly. Working with the same primitives rather than reimplementing.

### Why Built-in Extension Host

Full control over extension behavior. Standalone — no VS Code installation required. The API surface is finite and well-documented.

### Why Two Task States (not three)

Idle and Done are equivalent in steady state. The "Done" event is the *transition*, not a state. Simpler model, same functionality.
