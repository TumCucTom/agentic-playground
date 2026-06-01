# Layout Modes — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Author:** Thomas Bale + Zippy AI

## Goal

Add two layout modes to Canvas Workspace and let users toggle between them per workspace:

- **Canvas mode** (current behavior, enhanced) — infinite pan/zoom canvas with magnetic snapping while dragging or resizing panels.
- **Grid mode** (VS Code splits) — binary-split tiling that fills the viewport. No overlap, no gaps, no floating.

The mode is persisted per workspace. Switching modes preserves panel identity (and therefore PTY state, editor content, etc.); only geometry reflows.

## Why

The infinite canvas is great for ideation and arbitrary arrangement. For focused coding, users expect VS Code's tiled split layout — predictable, every pixel claimed, no overlap. Both shapes serve real workflows. Forcing one is wrong. A per-workspace toggle lets each workspace match its task.

## Non-goals

- VS Code marketplace extensions (separate effort).
- A flexible CSS-grid-like cell system with empty cells. Grid mode is true tiling only.
- Remembering per-mode geometry. Each mode switch recomputes layout from current state.
- Figma-style equal-spacing snap detection. Phase 2 candidate if requested.
- Snapping panels into "groups" that move together. Out of scope.

## User stories

1. In canvas mode, dragging a panel near another panel's edge snaps the dragged panel into alignment. A thin guide line appears at the snap target.
2. Holding ⌘ while dragging in canvas mode disables snapping for that drag.
3. ⌘⇧L toggles between canvas and grid modes. Panels reflow. PTY state, editor content, and webview contents survive.
4. In grid mode, ⌘\ splits the focused panel right (new vertical divider). ⌘- splits down (new horizontal divider).
5. In grid mode, dragging a divider resizes both neighbors.
6. Closing the app and reopening it restores each workspace at the mode it was last in.
7. An empty grid shows "Right-click to add a panel" — same affordance as canvas mode.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Canvas.tsx (entry)                                            │
│    layoutMode === 'grid'                                       │
│      ? <GridLayout tree={gridTree} />                          │
│      : <InfiniteCanvas viewport={viewport} />                  │
│                                                                │
│  Both render <Panel /> by id. Only geometry source differs.    │
└────────────────────────────────────────────────────────────────┘
        │                  │                       │
        ▼                  ▼                       ▼
  ┌─────────┐       ┌─────────────┐         ┌──────────────┐
  │ Panel   │       │ SnapEngine  │         │ splitTree    │
  │ (chrome,│       │ (pure fns,  │         │ (pure fns,   │
  │  drag,  │       │  used by    │         │  source of   │
  │  resize)│       │  drag in    │         │  geometry in │
  │         │       │  canvas)    │         │  grid)       │
  └─────────┘       └─────────────┘         └──────────────┘
```

`Panel.tsx` reads its geometry from one of two sources depending on mode. In grid mode, dragging is disabled; resizing routes to splitTree's `resizeDivider`. In canvas mode, dragging is mediated by SnapEngine.

## Data model

Additions to `src/shared/types.ts`:

```ts
export type LayoutMode = 'canvas' | 'grid';

export type SplitTree =
  | { kind: 'leaf'; panelId: string }
  | {
      kind: 'split';
      dir: 'h' | 'v';       // 'v' = vertical divider, children side-by-side (split right)
                             // 'h' = horizontal divider, children stacked     (split down)
      ratio: number;        // 0..1. Fraction of available space given to `a`.
      a: SplitTree;
      b: SplitTree;
    };

export interface CanvasState {
  panels: Panel[];                  // unchanged
  viewport: Viewport;               // ignored in grid mode
  selectedPanelIds: string[];       // unchanged
  workspaceName: string;            // unchanged
  lastUpdated: number;              // unchanged
  layoutMode: LayoutMode;           // NEW. default 'canvas'
  gridTree?: SplitTree;             // NEW. defined when layoutMode === 'grid' AND panels.length > 0
}
```

Migration: existing workspaces lack `layoutMode`. On load, default to `'canvas'`. No schema break.

## Pure helpers

### `src/renderer/layout/splitTree.ts`

All functions are pure — return new trees without mutation.

```ts
type LeafPath = number[];                 // sequence of 0|1 child indices to a leaf

splitLeaf(tree, panelId, newPanelId, dir): SplitTree
removeLeaf(tree, panelId): SplitTree | null   // null when tree becomes empty
resizeDivider(tree, leafPath, newRatio): SplitTree
findLeafPath(tree, panelId): LeafPath | null
firstLeaf(tree): string | null
allLeaves(tree): string[]
rectsFromTree(tree, viewport: Rect): Map<string, Rect>
```

Invariants enforced by these functions:
- A `split` node always has two children. Single-child splits are collapsed when removing a leaf.
- `ratio` is clamped to `[0.05, 0.95]` to prevent panels from disappearing.
- Every leaf's `panelId` must exist in `panels[]` (enforced by store actions, not the helper).

`rectsFromTree` walks the tree recursively, dividing the input rect by `ratio` at each split. Rects use integer pixel rounding to avoid sub-pixel rendering artifacts.

### `src/renderer/layout/snapEngine.ts`

```ts
interface Rect { x: number; y: number; w: number; h: number }

interface SnapGuide {
  axis: 'x' | 'y';
  position: number;        // canvas coord of the line
  from: number;            // canvas coord of segment start (perpendicular axis)
  to: number;              // canvas coord of segment end
}

interface SnapInput {
  dragRect: Rect;          // panel being dragged, canvas coords
  otherRects: Rect[];      // all other panels, canvas coords
  viewportRect: Rect;      // visible canvas, canvas coords
  zoom: number;            // viewport zoom; used to convert screen px → canvas px
  thresholdPx: number;     // screen-pixel threshold, typically 8
  disabled: boolean;       // true when ⌘ is held
}

interface SnapOutput {
  rect: Rect;              // possibly snapped position
  guides: SnapGuide[];     // line segments to render
}

snap(input: SnapInput): SnapOutput
```

Snap targets considered for each axis independently:

**X axis (dragged left, right, or center edge can snap to):**
- Left edges of other panels
- Right edges of other panels
- Horizontal centers of other panels
- Viewport left, right, horizontal center

**Y axis (dragged top, bottom, or center edge can snap to):**
- Top edges of other panels
- Bottom edges of other panels
- Vertical centers of other panels
- Viewport top, bottom, vertical center

Algorithm: for each of the 6 input edges (dragLeft, dragRight, dragCenterX, dragTop, dragBottom, dragCenterY) and each candidate target on the same axis, compute `|input - target| * zoom`. If under `thresholdPx`, this is a snap candidate. Pick the closest candidate per axis. Emit a guide when a snap happens.

When `disabled` is true, return the input rect unchanged and an empty guides array.

The same engine handles resize — pass the resize-target edge as a single-edge drag.

## Store actions

Additions to `src/renderer/store.ts`:

```ts
setLayoutMode(mode: LayoutMode): void
splitFocused(dir: 'h' | 'v', newPanel: Panel): void   // creates panel + splits the focused leaf
resizeDivider(leafPath: LeafPath, ratio: number): void
closeLeaf(panelId: string): void                       // grid mode only; also removes panel
```

`setLayoutMode` handles the mode-transition migrations described below. It's a single undo step.

Divider drags coalesce within the existing 100 ms window. Split and closeLeaf are individual undo steps.

When a panel is added in grid mode by means other than `splitFocused` (e.g., via context menu's "add panel"), it is inserted as a split of the currently-focused leaf with direction alternating (default 'v').

When a panel is removed in grid mode (e.g., via panel chrome's close button), the store routes to `closeLeaf` so the tree stays consistent.

## Mode transitions

### Canvas → Grid

1. If `panels.length === 0`: set `layoutMode = 'grid'`, `gridTree = undefined`.
2. Else: sort panels by `zOrder` ascending. Initialize `tree = { kind: 'leaf', panelId: panels[0].id }`. For each remaining panel `p`, replace the deepest left-most leaf with a 50/50 split whose `a` is the old leaf and `b` is `{ kind: 'leaf', panelId: p.id }`, alternating `dir` between `'v'` and `'h'` starting with `'v'`. This produces a predictable left-leaning tree where panels tile approximately evenly.
3. Set `gridTree` and `layoutMode = 'grid'`.

This algorithm is simple and predictable. It doesn't try to give the most-focused panel a larger share — every split is 50/50, so panel sizes are determined by their order. Users can resize dividers after the switch.

### Grid → Canvas

1. Compute current rects via `rectsFromTree(gridTree, currentViewportRect)`.
2. For each leaf, update its panel's `position` and `size` to the computed rect (now expressed in canvas coordinates).
3. Set `gridTree = undefined`, `layoutMode = 'canvas'`.
4. Viewport (pan/zoom) is preserved — user stays oriented.

Both transitions are atomic in the store and produce one undo step.

## UI components

### `LayoutModeToggle.tsx`

Segmented control in the toolbar (lives in `LayoutToolbar.tsx`). Two pills: `Canvas`, `Grid`. Active mode highlighted. Tooltip on each shows `⌘⇧L`. Click toggles.

Style: uses navigation-pill conventions from `~/.claude/design/DESIGN.md` — `rounded-[10px] px-4 py-2 text-[14px] font-medium`, active state `bg-white shadow-[0_1px_3px_rgba(20,18,14,0.08)]`.

### `GridLayout.tsx`

Renders a fullscreen container at viewport size. Calls `rectsFromTree`, places each `<Panel />` absolutely. Renders `<SplitDivider />` between each pair of siblings.

Empty state (gridTree undefined): centered text "Right-click to add a panel" (matches canvas's existing affordance).

### `SplitDivider.tsx`

A 4-px wide drag handle between siblings. Cursor: `col-resize` (vertical divider, dir 'v') or `row-resize` (horizontal divider, dir 'h'). Hover state: divider color shifts to accent purple (`#8B5CF6`).

`pointerdown` initiates drag. `pointermove` calls `resizeDivider` with the new ratio, clamped to `[0.05, 0.95]`. `pointerup` ends.

### `SnapGuides.tsx`

Overlay rendered above panels in canvas mode while dragging. Receives `guides: SnapGuide[]` and draws each as a 1-px line. Color: accent purple (`#8B5CF6`) with 80% opacity. Lines extend slightly beyond their `from`/`to` for visibility.

## Keyboard shortcuts

| Shortcut | Action                                  | Mode    |
|----------|-----------------------------------------|---------|
| ⌘⇧L      | Toggle layout mode                       | Both    |
| ⌘ (held) | Disable snap while dragging/resizing     | Canvas  |
| ⌘\       | Split focused panel right (dir 'v')      | Grid    |
| ⌘-       | Split focused panel down (dir 'h')       | Grid    |
| ⌘W       | Close focused panel                      | Grid    |

⌘\ and ⌘- match VS Code's "Split Editor Right" and "Split Editor Down" defaults. The "what panel type to add when splitting" question is answered with: a panel-type picker appears (the same one used by the canvas's add-panel context menu).

## Persistence

`layoutMode` and `gridTree` are serialized with the rest of `CanvasState`. Existing save/load paths require only the type updates. Loading a workspace without `layoutMode` defaults to `'canvas'`.

## Risks

- **Resize-observer feedback loop in grid mode.** Embedded video streams, terminals, and webviews observe their container's resize. If our resize updates trigger their observers which trigger ours, we loop. *Mitigation:* the store doesn't write geometry back from panel-side observers — panels in grid mode are passive geometry consumers. The existing 100 ms coalescing window catches anything that does.
- **Rapid splits before render.** ⌘\ hammered before the previous render commits. *Mitigation:* store actions are synchronous; no async gap between store update and tree consistency.
- **Tree/panels divergence.** A panel exists in `panels[]` but isn't a leaf in `gridTree` (or vice versa). *Mitigation:* store actions enforce consistency, and a dev-only assertion in `rectsFromTree` warns if a leaf's panelId isn't found.
- **Terminal panels mid-task during mode switch.** A running `npm install` shouldn't be killed. *Mitigation:* mode switch only changes geometry; PTYs are owned by main and addressed by panel id, which is preserved.
- **Viewport rect calculation drift.** Window resize in grid mode must recompute. *Mitigation:* `GridLayout.tsx` subscribes to a ResizeObserver on its root and re-renders on size change.

## Testing

### Unit (`tests/unit/`)

- `splitTree.test.ts`
  - `splitLeaf` adds a leaf at the right location, alternating directions
  - `removeLeaf` collapses single-child splits and returns null for empty
  - `resizeDivider` clamps ratio
  - `findLeafPath` returns correct path for nested leaves
  - `rectsFromTree` math (single leaf = full rect; horizontal split = half/half by default ratio 0.5; deep trees)
- `snapEngine.test.ts`
  - Snaps left edge to other's left, right, center
  - Snaps to viewport edges
  - Independent X and Y snapping (snap on X without Y)
  - `disabled` returns input unchanged
  - Threshold respected (snap at 7 px, no snap at 9 px with `thresholdPx=8`)
- Store tests
  - `setLayoutMode` preserves panel ids across switch
  - Canvas → Grid → Canvas round-trip preserves panel ids (geometry may differ, that's expected)
  - Undo a mode switch restores prior mode and geometry

### E2E (`tests/e2e/canvas.spec.ts`)

- Toggle to grid mode via UI button — verify panels are tiled (no overlap, fills viewport).
- ⌘\ in grid mode — verify a new panel split appears.
- Drag a divider — verify the ratio updates and both panels resize.
- Toggle back to canvas — verify panels float at their last computed positions.
- In canvas mode, drag a panel near another — verify a snap guide line appears in the DOM.

## Implementation phases

1. **Data model + persistence.** Add types, store fields, defaults. Load/save handles new fields.
2. **Pure helpers.** `splitTree.ts` and `snapEngine.ts` with full unit-test coverage.
3. **Grid layout component + dividers.** Render tree to rects, draw `SplitDivider`s.
4. **Snap integration in canvas mode.** Wire `SnapEngine` into Panel drag/resize. Render `SnapGuides` overlay.
5. **Mode toggle UI + transitions.** `LayoutModeToggle`, ⌘⇧L shortcut, transition logic.
6. **Grid-mode keyboard shortcuts.** ⌘\, ⌘-, ⌘W with panel-type picker.
7. **E2E tests + README update.**

Each phase is independently shippable. Phase 1 alone gives mode plumbing without UI. Phases 2–3 unlock grid mode. Phase 4 adds canvas-mode snapping. Phases 5–7 polish.
