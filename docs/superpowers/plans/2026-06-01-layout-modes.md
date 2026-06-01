# Layout Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two per-workspace layout modes — canvas (current pan/zoom + magnetic snapping) and grid (VS Code-style binary-split tiling) — with a ⌘⇧L toggle, state-preserving mode transitions, and unit + e2e coverage.

**Architecture:** Single `layoutMode` field on `CanvasState` chooses the geometry source. In canvas mode, panels use their own `position`/`size` and a pure `SnapEngine` decorates drag/resize. In grid mode, a binary `SplitTree` owns geometry — `GridLayout` derives rects from the tree and renders `SplitDivider`s between siblings. Mode switches are atomic store actions; panel identity (and therefore PTY/editor/webview state) is preserved across switches. Old workspaces default to `'canvas'` — no schema break.

**Tech Stack:** TypeScript, React 18, Zustand, vitest, playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-01-layout-modes-design.md`

---

## File Structure

### New files

- `src/renderer/layout/splitTree.ts` — pure helpers for the SplitTree (split, remove, resize, derive rects)
- `src/renderer/layout/snapEngine.ts` — pure snap math for canvas mode
- `src/renderer/layout/GridLayout.tsx` — renders the tree to a fullscreen tiled layout
- `src/renderer/layout/SplitDivider.tsx` — drag handle between siblings
- `src/renderer/layout/SnapGuides.tsx` — overlay drawing snap lines during a drag
- `src/renderer/layout/LayoutModeToggle.tsx` — toolbar segmented control
- `tests/unit/splitTree.test.ts`
- `tests/unit/snapEngine.test.ts`

### Modified files

- `src/shared/types.ts` — add `LayoutMode`, `SplitTree`; add fields to `CanvasState`
- `src/renderer/state/canvasStore.ts` — add `layoutMode`/`gridTree` state, snapshot/restore in history, mode-transition actions, grid-edit actions
- `src/renderer/Canvas.tsx` — branch on `layoutMode`, integrate snap engine, host `SnapGuides`
- `src/renderer/App.tsx` — host `LayoutModeToggle`, wire ⌘⇧L
- `src/renderer/Panel.tsx` — accept a `geometrySource: 'panel' | 'grid'` prop so grid mode can override position/size
- `tests/e2e/canvas.spec.ts` — add layout-mode e2e tests
- `tests/unit/canvasStore.test.ts` — add tests for new store actions
- `README.md` — document the modes and shortcut

---

## Task 1: Add `LayoutMode` and `SplitTree` types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Edit `src/shared/types.ts`** to add new types and extend `CanvasState`

Add at the bottom (just before `Workspace`):

```ts
export type LayoutMode = 'canvas' | 'grid';

export type SplitTree =
  | { kind: 'leaf'; panelId: string }
  | {
      kind: 'split';
      dir: 'h' | 'v';
      ratio: number;
      a: SplitTree;
      b: SplitTree;
    };
```

Extend the `CanvasState` interface (currently lines 81–87):

```ts
export interface CanvasState {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
  workspaceName: string;
  lastUpdated: number;
  layoutMode: LayoutMode;
  gridTree?: SplitTree;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS — but expect errors in `canvasStore.ts` and load/save paths because they don't set `layoutMode` yet. We'll fix those in the next task.

Note: it's OK that this step shows errors *only* in files we're about to modify (store + initialize paths). If errors appear in unrelated files, stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "$(cat <<'EOF'
types: add LayoutMode and SplitTree

Layout-mode feature requires a per-workspace mode flag and a
binary split tree for grid-mode geometry. Backing types only;
no logic yet.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 2: Wire `layoutMode` / `gridTree` into the store

**Files:**
- Modify: `src/renderer/state/canvasStore.ts:1-268`

- [ ] **Step 1: Update imports and CanvasStore interface**

In `src/renderer/state/canvasStore.ts`, update the imports (line 2):

```ts
import { CanvasState, Panel, PanelPosition, Viewport, LayoutMode, SplitTree } from '../../shared/types';
```

Update `HistoryEntry` (lines 7–12) so undo/redo preserves layout state:

```ts
interface HistoryEntry {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
  layoutMode: LayoutMode;
  gridTree?: SplitTree;
  timestamp: number;
}
```

Update `snapshot()` (lines 42–49):

```ts
function snapshot(s: {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
  layoutMode: LayoutMode;
  gridTree?: SplitTree;
}): HistoryEntry {
  return {
    panels: s.panels.map((p) => ({ ...p, position: { ...p.position }, size: { ...p.size } })),
    viewport: { ...s.viewport },
    selectedPanelIds: [...s.selectedPanelIds],
    layoutMode: s.layoutMode,
    gridTree: s.gridTree ? cloneTree(s.gridTree) : undefined,
    timestamp: Date.now(),
  };
}

function cloneTree(tree: SplitTree): SplitTree {
  if (tree.kind === 'leaf') return { kind: 'leaf', panelId: tree.panelId };
  return { kind: 'split', dir: tree.dir, ratio: tree.ratio, a: cloneTree(tree.a), b: cloneTree(tree.b) };
}
```

Add the new fields to the initial state object (around lines 71–78):

```ts
panels: [],
viewport: { x: 0, y: 0, zoom: 1 },
selectedPanelIds: [],
workspaceName: 'default',
lastUpdated: Date.now(),
layoutMode: 'canvas',
gridTree: undefined,
isDirty: false,
past: [],
future: [],
```

Update `serialize()` (lines 223–226):

```ts
serialize: () => {
  const { panels, viewport, selectedPanelIds, workspaceName, lastUpdated, layoutMode, gridTree } = get();
  return { panels, viewport, selectedPanelIds, workspaceName, lastUpdated, layoutMode, gridTree };
},
```

Update `initialize()` (lines 80–83) to accept old workspaces missing `layoutMode`:

```ts
initialize: (state) => {
  maxZOrder = state.panels.reduce((max, p) => Math.max(max, p.zOrder), 0);
  set({
    ...state,
    layoutMode: state.layoutMode ?? 'canvas',
    gridTree: state.gridTree,
    isDirty: false,
    past: [],
    future: [],
  });
},
```

Update `undo()` and `redo()` to restore the new fields. In `undo()` (after line 237):

```ts
set({
  panels: previous.panels,
  viewport: previous.viewport,
  selectedPanelIds: previous.selectedPanelIds,
  layoutMode: previous.layoutMode,
  gridTree: previous.gridTree,
  past: remaining,
  future: [...get().future, current],
  isDirty: true,
});
```

Same shape in `redo()`.

- [ ] **Step 2: Add CanvasStore interface stubs (no implementations yet)**

In the `CanvasStore` interface (lines 14–38), add new method signatures after `applyOneBigNSmall`:

```ts
setLayoutMode: (mode: LayoutMode) => void;
splitFocused: (dir: 'h' | 'v', newPanel: Panel) => void;
resizeDivider: (leafPath: number[], ratio: number) => void;
closeLeaf: (panelId: string) => void;
```

Add stub implementations near the bottom of the store (before `markClean` at line 221) — they'll be filled in by later tasks:

```ts
setLayoutMode: (_mode) => { /* implemented in Task 11 */ },
splitFocused: (_dir, _panel) => { /* implemented in Task 14 */ },
resizeDivider: (_path, _ratio) => { /* implemented in Task 7 */ },
closeLeaf: (_id) => { /* implemented in Task 15 */ },
```

- [ ] **Step 3: Run existing tests to ensure nothing broke**

Run: `npm test`
Expected: all existing tests still PASS (we only added optional/defaulted fields).

- [ ] **Step 4: Add a unit test that load defaults to canvas mode**

Open `tests/unit/canvasStore.test.ts` and add a new describe block at the end:

```ts
describe('layout mode defaults', () => {
  it('defaults to canvas mode when loading state without layoutMode', () => {
    const stateWithoutMode = {
      panels: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedPanelIds: [],
      workspaceName: 'test',
      lastUpdated: Date.now(),
    } as any;
    useCanvasStore.getState().initialize(stateWithoutMode);
    expect(useCanvasStore.getState().layoutMode).toBe('canvas');
    expect(useCanvasStore.getState().gridTree).toBeUndefined();
  });

  it('preserves layoutMode when loading state that has it', () => {
    const stateWithMode = {
      panels: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedPanelIds: [],
      workspaceName: 'test',
      lastUpdated: Date.now(),
      layoutMode: 'grid' as const,
      gridTree: undefined,
    };
    useCanvasStore.getState().initialize(stateWithMode);
    expect(useCanvasStore.getState().layoutMode).toBe('grid');
  });
});
```

- [ ] **Step 5: Run tests, verify new tests pass**

Run: `npm test -- canvasStore`
Expected: all PASS including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/state/canvasStore.ts tests/unit/canvasStore.test.ts
git commit -m "$(cat <<'EOF'
store: add layoutMode + gridTree state with undo support

History entries now snapshot layoutMode and gridTree so mode
switches are undoable. Old workspaces load defaulting to canvas
mode. Action stubs added for the four new operations; bodies
land in later tasks.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 3: Write `splitTree.ts` pure helpers

**Files:**
- Create: `src/renderer/layout/splitTree.ts`
- Create: `tests/unit/splitTree.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/splitTree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  splitLeaf,
  removeLeaf,
  resizeDivider,
  findLeafPath,
  firstLeaf,
  allLeaves,
  rectsFromTree,
} from '../../src/renderer/layout/splitTree';
import { SplitTree } from '../../src/shared/types';

const leaf = (id: string): SplitTree => ({ kind: 'leaf', panelId: id });

describe('splitTree', () => {
  describe('splitLeaf', () => {
    it('splits a leaf into a split node with new panel on side b', () => {
      const tree = leaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'v');
      expect(result).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      });
    });

    it('splits a nested leaf', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const result = splitLeaf(tree, 'b', 'c', 'h');
      expect(result).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      });
    });

    it('returns the tree unchanged when leaf id is not found', () => {
      const tree = leaf('a');
      const result = splitLeaf(tree, 'z', 'b', 'v');
      expect(result).toEqual(tree);
    });
  });

  describe('removeLeaf', () => {
    it('returns null when removing the only leaf', () => {
      expect(removeLeaf(leaf('a'), 'a')).toBeNull();
    });

    it('collapses a split into its surviving sibling', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(removeLeaf(tree, 'a')).toEqual(leaf('b'));
      expect(removeLeaf(tree, 'b')).toEqual(leaf('a'));
    });

    it('returns the tree unchanged when leaf is not found', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(removeLeaf(tree, 'z')).toEqual(tree);
    });

    it('handles deep removal', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      expect(removeLeaf(tree, 'b')).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('c'),
      });
    });
  });

  describe('resizeDivider', () => {
    it('updates the ratio at the given path', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const result = resizeDivider(tree, [], 0.7);
      expect(result).toMatchObject({ ratio: 0.7 });
    });

    it('clamps ratio to [0.05, 0.95]', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect((resizeDivider(tree, [], 0.01) as any).ratio).toBe(0.05);
      expect((resizeDivider(tree, [], 0.99) as any).ratio).toBe(0.95);
    });

    it('updates a nested split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      const result = resizeDivider(tree, [1], 0.3);
      expect(result).toMatchObject({
        a: leaf('a'),
        b: { ratio: 0.3 },
      });
    });
  });

  describe('findLeafPath', () => {
    it('returns empty path for a root leaf', () => {
      expect(findLeafPath(leaf('a'), 'a')).toEqual([]);
    });

    it('returns the path through a nested tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      expect(findLeafPath(tree, 'a')).toEqual([0]);
      expect(findLeafPath(tree, 'b')).toEqual([1, 0]);
      expect(findLeafPath(tree, 'c')).toEqual([1, 1]);
    });

    it('returns null when leaf not present', () => {
      expect(findLeafPath(leaf('a'), 'z')).toBeNull();
    });
  });

  describe('firstLeaf and allLeaves', () => {
    it('finds the leftmost leaf', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('a'), b: leaf('b') },
        b: leaf('c'),
      };
      expect(firstLeaf(tree)).toBe('a');
    });

    it('lists all leaves in left-to-right order', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('a'), b: leaf('b') },
        b: leaf('c'),
      };
      expect(allLeaves(tree)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('rectsFromTree', () => {
    const viewport = { x: 0, y: 0, w: 800, h: 600 };

    it('gives the full rect to a single leaf', () => {
      const rects = rectsFromTree(leaf('a'), viewport);
      expect(rects.get('a')).toEqual(viewport);
    });

    it('splits a vertical divider 50/50 horizontally', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 600 });
      expect(rects.get('b')).toEqual({ x: 400, y: 0, w: 400, h: 600 });
    });

    it('splits a horizontal divider 50/50 vertically', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 800, h: 300 });
      expect(rects.get('b')).toEqual({ x: 0, y: 300, w: 800, h: 300 });
    });

    it('respects non-default ratios', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.25,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 200, h: 600 });
      expect(rects.get('b')).toEqual({ x: 200, y: 0, w: 600, h: 600 });
    });

    it('handles a nested tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 600 });
      expect(rects.get('b')).toEqual({ x: 400, y: 0, w: 400, h: 300 });
      expect(rects.get('c')).toEqual({ x: 400, y: 300, w: 400, h: 300 });
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- splitTree`
Expected: FAIL — `splitTree.ts` does not exist.

- [ ] **Step 3: Create `src/renderer/layout/splitTree.ts`**

```ts
import { SplitTree } from '../../shared/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_RATIO = 0.05;
const MAX_RATIO = 0.95;

export function splitLeaf(
  tree: SplitTree,
  panelId: string,
  newPanelId: string,
  dir: 'h' | 'v'
): SplitTree {
  if (tree.kind === 'leaf') {
    if (tree.panelId !== panelId) return tree;
    return {
      kind: 'split',
      dir,
      ratio: 0.5,
      a: { kind: 'leaf', panelId },
      b: { kind: 'leaf', panelId: newPanelId },
    };
  }
  return {
    ...tree,
    a: splitLeaf(tree.a, panelId, newPanelId, dir),
    b: splitLeaf(tree.b, panelId, newPanelId, dir),
  };
}

export function removeLeaf(tree: SplitTree, panelId: string): SplitTree | null {
  if (tree.kind === 'leaf') {
    return tree.panelId === panelId ? null : tree;
  }
  const a = removeLeaf(tree.a, panelId);
  const b = removeLeaf(tree.b, panelId);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return { ...tree, a, b };
}

export function resizeDivider(tree: SplitTree, path: number[], newRatio: number): SplitTree {
  const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, newRatio));
  if (path.length === 0) {
    if (tree.kind !== 'split') return tree;
    return { ...tree, ratio: clamped };
  }
  if (tree.kind !== 'split') return tree;
  const [head, ...rest] = path;
  if (head === 0) return { ...tree, a: resizeDivider(tree.a, rest, newRatio) };
  return { ...tree, b: resizeDivider(tree.b, rest, newRatio) };
}

export function findLeafPath(tree: SplitTree, panelId: string): number[] | null {
  if (tree.kind === 'leaf') {
    return tree.panelId === panelId ? [] : null;
  }
  const a = findLeafPath(tree.a, panelId);
  if (a !== null) return [0, ...a];
  const b = findLeafPath(tree.b, panelId);
  if (b !== null) return [1, ...b];
  return null;
}

export function firstLeaf(tree: SplitTree): string | null {
  if (tree.kind === 'leaf') return tree.panelId;
  return firstLeaf(tree.a);
}

export function allLeaves(tree: SplitTree): string[] {
  if (tree.kind === 'leaf') return [tree.panelId];
  return [...allLeaves(tree.a), ...allLeaves(tree.b)];
}

export function rectsFromTree(tree: SplitTree, viewport: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>();
  walk(tree, viewport);
  return out;

  function walk(node: SplitTree, rect: Rect): void {
    if (node.kind === 'leaf') {
      out.set(node.panelId, rect);
      return;
    }
    if (node.dir === 'v') {
      const w = Math.round(rect.w * node.ratio);
      walk(node.a, { x: rect.x, y: rect.y, w, h: rect.h });
      walk(node.b, { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h });
    } else {
      const h = Math.round(rect.h * node.ratio);
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h });
      walk(node.b, { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- splitTree`
Expected: PASS — all 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/layout/splitTree.ts tests/unit/splitTree.test.ts
git commit -m "$(cat <<'EOF'
layout: splitTree pure helpers + tests

splitLeaf / removeLeaf / resizeDivider / findLeafPath /
firstLeaf / allLeaves / rectsFromTree. All immutable, all
covered.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 4: Write `snapEngine.ts` pure helpers

**Files:**
- Create: `src/renderer/layout/snapEngine.ts`
- Create: `tests/unit/snapEngine.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/snapEngine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snap } from '../../src/renderer/layout/snapEngine';

const baseInput = {
  dragRect: { x: 100, y: 100, w: 200, h: 100 },
  otherRects: [{ x: 400, y: 100, w: 200, h: 100 }],
  viewportRect: { x: 0, y: 0, w: 1000, h: 800 },
  zoom: 1,
  thresholdPx: 8,
  disabled: false,
};

describe('snapEngine', () => {
  it('snaps drag right edge to other left edge when within threshold', () => {
    // drag right edge is at 300; other left edge is at 400; gap = 100, no snap
    // move drag closer: drag.x = 195 → right = 395, gap = 5, snap to make right = 400
    const result = snap({ ...baseInput, dragRect: { x: 195, y: 100, w: 200, h: 100 } });
    expect(result.rect.x).toBe(200); // right edge now at 400
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('does not snap when outside threshold', () => {
    // drag at x=100, right edge at 300, other left at 400 → gap 100, no snap
    const result = snap(baseInput);
    expect(result.rect).toEqual(baseInput.dragRect);
    expect(result.guides).toEqual([]);
  });

  it('respects disabled flag', () => {
    const result = snap({
      ...baseInput,
      dragRect: { x: 195, y: 100, w: 200, h: 100 },
      disabled: true,
    });
    expect(result.rect.x).toBe(195);
    expect(result.guides).toEqual([]);
  });

  it('snaps independently on X and Y axes', () => {
    // X: gap 5 from drag right (195+200=395) to other left (400) → snaps
    // Y: gap 50 from drag top (50) to other top (100) → no snap
    const result = snap({
      ...baseInput,
      dragRect: { x: 195, y: 50, w: 200, h: 100 },
    });
    expect(result.rect.x).toBe(200); // X snapped
    expect(result.rect.y).toBe(50);  // Y unchanged
  });

  it('snaps to viewport left edge', () => {
    const result = snap({
      ...baseInput,
      dragRect: { x: 4, y: 100, w: 200, h: 100 },
    });
    expect(result.rect.x).toBe(0);
  });

  it('snaps to viewport right edge', () => {
    const result = snap({
      ...baseInput,
      dragRect: { x: 796, y: 100, w: 200, h: 100 },
    });
    expect(result.rect.x).toBe(800); // right edge of drag at viewport.w=1000
  });

  it('snaps to other panel center (horizontal)', () => {
    // other panel center X = 500; drag center should snap to 500
    // drag.x s.t. center = 495 → x = 395
    const result = snap({
      ...baseInput,
      dragRect: { x: 395, y: 100, w: 200, h: 100 },
    });
    expect(result.rect.x + result.rect.w / 2).toBe(500);
  });

  it('threshold scales with zoom (snap distance in screen pixels)', () => {
    // at zoom=2, threshold 8 screen-px = 4 canvas-px
    // drag right at 396, other left at 400, gap 4 canvas-px = 8 screen-px → snap
    const result = snap({
      ...baseInput,
      dragRect: { x: 196, y: 100, w: 200, h: 100 },
      zoom: 2,
    });
    expect(result.rect.x).toBe(200);
  });

  it('returns empty otherRects without crashing', () => {
    const result = snap({ ...baseInput, otherRects: [] });
    // Still snaps to viewport, doesn't crash
    expect(result.rect).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- snapEngine`
Expected: FAIL — `snapEngine.ts` does not exist.

- [ ] **Step 3: Create `src/renderer/layout/snapEngine.ts`**

```ts
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

export interface SnapInput {
  dragRect: Rect;
  otherRects: Rect[];
  viewportRect: Rect;
  zoom: number;
  thresholdPx: number;
  disabled: boolean;
}

export interface SnapOutput {
  rect: Rect;
  guides: SnapGuide[];
}

interface AxisTarget {
  position: number;
  guideFrom: number;
  guideTo: number;
}

export function snap(input: SnapInput): SnapOutput {
  if (input.disabled) {
    return { rect: input.dragRect, guides: [] };
  }

  const { dragRect, otherRects, viewportRect, zoom, thresholdPx } = input;
  const thresholdCanvas = thresholdPx / zoom;

  // Candidate X-axis target lines (positions). Each can attract dragLeft,
  // dragRight, or dragCenterX.
  const xTargets: AxisTarget[] = [];
  // Viewport edges + center
  xTargets.push(target(viewportRect.x, viewportRect.y, viewportRect.y + viewportRect.h));
  xTargets.push(target(viewportRect.x + viewportRect.w, viewportRect.y, viewportRect.y + viewportRect.h));
  xTargets.push(target(viewportRect.x + viewportRect.w / 2, viewportRect.y, viewportRect.y + viewportRect.h));
  // Other panel edges + center
  for (const o of otherRects) {
    xTargets.push(target(o.x, o.y, o.y + o.h));
    xTargets.push(target(o.x + o.w, o.y, o.y + o.h));
    xTargets.push(target(o.x + o.w / 2, o.y, o.y + o.h));
  }

  const yTargets: AxisTarget[] = [];
  yTargets.push(target(viewportRect.y, viewportRect.x, viewportRect.x + viewportRect.w));
  yTargets.push(target(viewportRect.y + viewportRect.h, viewportRect.x, viewportRect.x + viewportRect.w));
  yTargets.push(target(viewportRect.y + viewportRect.h / 2, viewportRect.x, viewportRect.x + viewportRect.w));
  for (const o of otherRects) {
    yTargets.push(target(o.y, o.x, o.x + o.w));
    yTargets.push(target(o.y + o.h, o.x, o.x + o.w));
    yTargets.push(target(o.y + o.h / 2, o.x, o.x + o.w));
  }

  // Try to snap dragLeft, dragRight, dragCenterX to any xTarget.
  const dragLeft = dragRect.x;
  const dragRight = dragRect.x + dragRect.w;
  const dragCenterX = dragRect.x + dragRect.w / 2;
  const xPick = pickBest(
    [
      { dragSide: 'left', dragValue: dragLeft },
      { dragSide: 'right', dragValue: dragRight },
      { dragSide: 'center', dragValue: dragCenterX },
    ],
    xTargets,
    thresholdCanvas
  );

  const dragTop = dragRect.y;
  const dragBottom = dragRect.y + dragRect.h;
  const dragCenterY = dragRect.y + dragRect.h / 2;
  const yPick = pickBest(
    [
      { dragSide: 'top', dragValue: dragTop },
      { dragSide: 'bottom', dragValue: dragBottom },
      { dragSide: 'center', dragValue: dragCenterY },
    ],
    yTargets,
    thresholdCanvas
  );

  const guides: SnapGuide[] = [];
  let outX = dragRect.x;
  let outY = dragRect.y;

  if (xPick) {
    // Adjust dragRect.x so that the matching side lines up with the target
    if (xPick.dragSide === 'left') outX = xPick.target.position;
    else if (xPick.dragSide === 'right') outX = xPick.target.position - dragRect.w;
    else outX = xPick.target.position - dragRect.w / 2;
    guides.push({
      axis: 'x',
      position: xPick.target.position,
      from: xPick.target.guideFrom,
      to: xPick.target.guideTo,
    });
  }
  if (yPick) {
    if (yPick.dragSide === 'top') outY = yPick.target.position;
    else if (yPick.dragSide === 'bottom') outY = yPick.target.position - dragRect.h;
    else outY = yPick.target.position - dragRect.h / 2;
    guides.push({
      axis: 'y',
      position: yPick.target.position,
      from: yPick.target.guideFrom,
      to: yPick.target.guideTo,
    });
  }

  return {
    rect: { x: outX, y: outY, w: dragRect.w, h: dragRect.h },
    guides,
  };

  function target(position: number, guideFrom: number, guideTo: number): AxisTarget {
    return { position, guideFrom, guideTo };
  }
}

function pickBest(
  dragSides: Array<{ dragSide: string; dragValue: number }>,
  targets: AxisTarget[],
  threshold: number
): { dragSide: string; target: AxisTarget } | null {
  let best: { dragSide: string; target: AxisTarget; distance: number } | null = null;
  for (const ds of dragSides) {
    for (const t of targets) {
      const d = Math.abs(ds.dragValue - t.position);
      if (d <= threshold && (!best || d < best.distance)) {
        best = { dragSide: ds.dragSide, target: t, distance: d };
      }
    }
  }
  return best ? { dragSide: best.dragSide, target: best.target } : null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- snapEngine`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/layout/snapEngine.ts tests/unit/snapEngine.test.ts
git commit -m "$(cat <<'EOF'
layout: snapEngine pure helper + tests

Independent X/Y snapping against other panels and viewport
edges/centers. Threshold in screen pixels (zoom-aware). Hold-Cmd
disable handled by caller via the `disabled` flag.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 5: Implement `setLayoutMode` store action

**Files:**
- Modify: `src/renderer/state/canvasStore.ts`

- [ ] **Step 1: Replace the `setLayoutMode` stub with the real implementation**

In `src/renderer/state/canvasStore.ts`, add imports at the top:

```ts
import { allLeaves, firstLeaf, rectsFromTree, splitLeaf } from '../layout/splitTree';
```

Replace the `setLayoutMode` stub with:

```ts
setLayoutMode: (mode) => {
  const s = get();
  if (s.layoutMode === mode) return;
  pushHistory();
  if (mode === 'grid') {
    // Canvas → Grid: build a left-leaning tree
    if (s.panels.length === 0) {
      set({ layoutMode: 'grid', gridTree: undefined, isDirty: true });
      return;
    }
    const sorted = [...s.panels].sort((a, b) => a.zOrder - b.zOrder);
    let tree: SplitTree = { kind: 'leaf', panelId: sorted[0].id };
    let dir: 'h' | 'v' = 'v';
    for (let i = 1; i < sorted.length; i++) {
      // Always split the leftmost leaf so growth is predictable.
      const leftmost = firstLeaf(tree);
      if (!leftmost) break;
      tree = splitLeaf(tree, leftmost, sorted[i].id, dir);
      dir = dir === 'v' ? 'h' : 'v';
    }
    set({ layoutMode: 'grid', gridTree: tree, isDirty: true });
  } else {
    // Grid → Canvas: write rects into panel position/size
    if (!s.gridTree) {
      set({ layoutMode: 'canvas', gridTree: undefined, isDirty: true });
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rects = rectsFromTree(s.gridTree, { x: 0, y: 0, w: vw, h: vh });
    const panels = s.panels.map((p) => {
      const r = rects.get(p.id);
      if (!r) return p;
      // Translate from viewport coords to canvas coords
      return {
        ...p,
        position: { x: r.x / s.viewport.zoom + s.viewport.x, y: r.y / s.viewport.zoom + s.viewport.y },
        size: { width: r.w / s.viewport.zoom, height: r.h / s.viewport.zoom },
      };
    });
    set({ layoutMode: 'canvas', gridTree: undefined, panels, isDirty: true });
  }
},
```

Also replace the `resizeDivider` stub:

```ts
resizeDivider: (path, ratio) => {
  pushHistory();
  set((s) => {
    if (!s.gridTree) return s;
    return { gridTree: resizeDividerTree(s.gridTree, path, ratio), isDirty: true };
  });
},
```

Add `resizeDividerTree` to the imports (rename if conflict):

```ts
import { allLeaves, firstLeaf, rectsFromTree, resizeDivider as resizeDividerTree, splitLeaf } from '../layout/splitTree';
```

- [ ] **Step 2: Write a unit test for the round-trip**

Append to `tests/unit/canvasStore.test.ts`:

```ts
describe('layout mode transitions', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      panels: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedPanelIds: [],
      past: [],
      future: [],
      isDirty: false,
      layoutMode: 'canvas',
      gridTree: undefined,
    });
  });

  it('canvas → grid builds a tree containing every panel', () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    useCanvasStore.getState().addPanel(makePanel('b'));
    useCanvasStore.getState().addPanel(makePanel('c'));
    useCanvasStore.getState().setLayoutMode('grid');
    const { gridTree, layoutMode } = useCanvasStore.getState();
    expect(layoutMode).toBe('grid');
    expect(gridTree).toBeDefined();
    const ids: string[] = [];
    function collect(t: any): void {
      if (t.kind === 'leaf') ids.push(t.panelId);
      else { collect(t.a); collect(t.b); }
    }
    collect(gridTree);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('grid → canvas writes rects into panels', () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    useCanvasStore.getState().addPanel(makePanel('b'));
    useCanvasStore.getState().setLayoutMode('grid');
    useCanvasStore.getState().setLayoutMode('canvas');
    const { layoutMode, gridTree, panels } = useCanvasStore.getState();
    expect(layoutMode).toBe('canvas');
    expect(gridTree).toBeUndefined();
    // Panels should have non-zero size after the round-trip
    expect(panels[0].size.width).toBeGreaterThan(0);
    expect(panels[0].size.height).toBeGreaterThan(0);
  });

  it('setLayoutMode is idempotent', () => {
    useCanvasStore.getState().setLayoutMode('canvas');
    const pastLength = useCanvasStore.getState().past.length;
    useCanvasStore.getState().setLayoutMode('canvas');
    expect(useCanvasStore.getState().past.length).toBe(pastLength);
  });

  it('empty workspace switching to grid has undefined gridTree', () => {
    useCanvasStore.getState().setLayoutMode('grid');
    expect(useCanvasStore.getState().gridTree).toBeUndefined();
    expect(useCanvasStore.getState().layoutMode).toBe('grid');
  });
});
```

- [ ] **Step 3: Run tests, verify they pass**

Run: `npm test -- canvasStore`
Expected: PASS — including the four new tests.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/state/canvasStore.ts tests/unit/canvasStore.test.ts
git commit -m "$(cat <<'EOF'
store: implement setLayoutMode + resizeDivider

Canvas → Grid builds a left-leaning tree from existing panels.
Grid → Canvas writes the tree's computed rects back into each
panel's position/size. Both directions are single undo steps.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 6: Create `SplitDivider.tsx`

**Files:**
- Create: `src/renderer/layout/SplitDivider.tsx`

- [ ] **Step 1: Create the divider component**

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../state/canvasStore';

interface SplitDividerProps {
  path: number[];
  dir: 'h' | 'v';            // h = horizontal divider line (children stacked); v = vertical divider line (children side-by-side)
  position: number;          // pixel position of the divider's center along the perpendicular axis
  from: number;              // pixel start of the divider line along the parallel axis
  to: number;                // pixel end of the divider line along the parallel axis
  containerSize: number;     // size of the parent split node along the divider's perpendicular axis (used to compute new ratio)
  containerStart: number;    // start of the parent split along the perpendicular axis (offset for ratio calculation)
}

const DIVIDER_THICKNESS = 4;
const HIT_PADDING = 2;        // expand hit area for easier grabbing

export const SplitDivider: React.FC<SplitDividerProps> = ({
  path,
  dir,
  position,
  from,
  to,
  containerSize,
  containerStart,
}) => {
  const resizeDivider = useCanvasStore((s) => s.resizeDivider);
  const [hover, setHover] = useState(false);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    // dir 'v' means the divider line is vertical, so dragging in X changes the ratio
    const pointer = dir === 'v' ? e.clientX : e.clientY;
    const ratio = (pointer - containerStart) / containerSize;
    resizeDivider(path, ratio);
  }, [dir, containerSize, containerStart, path, resizeDivider]);

  const style: React.CSSProperties = dir === 'v'
    ? {
        position: 'absolute',
        left: position - DIVIDER_THICKNESS / 2 - HIT_PADDING,
        top: from,
        width: DIVIDER_THICKNESS + HIT_PADDING * 2,
        height: to - from,
        cursor: 'col-resize',
        background: hover || draggingRef.current ? 'rgba(139, 92, 246, 0.4)' : 'transparent',
        transition: 'background 120ms',
        zIndex: 10,
      }
    : {
        position: 'absolute',
        top: position - DIVIDER_THICKNESS / 2 - HIT_PADDING,
        left: from,
        height: DIVIDER_THICKNESS + HIT_PADDING * 2,
        width: to - from,
        cursor: 'row-resize',
        background: hover || draggingRef.current ? 'rgba(139, 92, 246, 0.4)' : 'transparent',
        transition: 'background 120ms',
        zIndex: 10,
      };

  return (
    <div
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/layout/SplitDivider.tsx
git commit -m "$(cat <<'EOF'
layout: SplitDivider drag-to-resize handle

Pointer-captured divider between split-tree siblings. Cursor
swaps between col-resize and row-resize. Subtle purple-accent
hover state to signal grabbability without distraction.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 7: Create `GridLayout.tsx`

**Files:**
- Create: `src/renderer/layout/GridLayout.tsx`
- Modify: `src/renderer/Panel.tsx` — add `geometryOverride` prop

- [ ] **Step 1: Update Panel.tsx to accept geometry overrides**

In `src/renderer/Panel.tsx`, update `PanelViewProps` (lines 13–19):

```tsx
interface PanelViewProps {
  panel: PanelType;
  isSelected: boolean;
  onFocus: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
  geometryOverride?: { x: number; y: number; width: number; height: number };
  dragDisabled?: boolean;
}
```

Update the destructuring (lines 21–27):

```tsx
export const PanelView: React.FC<PanelViewProps> = ({
  panel,
  isSelected,
  onFocus,
  onDragStart,
  onResizeStart,
  geometryOverride,
  dragDisabled = false,
}) => {
```

Use the override in the style (lines 68–74), replacing the four geometry fields:

```tsx
left: geometryOverride?.x ?? panel.position.x,
top: geometryOverride?.y ?? panel.position.y,
width: geometryOverride?.width ?? panel.size.width,
height: geometryOverride?.height ?? panel.size.height,
```

Update `handleTitleBarMouseDown` (lines 32–39) to skip drag when disabled:

```tsx
const handleTitleBarMouseDown = (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('.panel-close, .panel-state-toggle')) return;
  e.stopPropagation();
  onFocus();
  if (dragDisabled) return;
  onDragStart(e);
  setIsDragging(true);
};
```

In the titlebar inline `cursor` (line 104), reflect the disabled state:

```tsx
cursor: dragDisabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
```

Also gate the SE resize handle (line 184–190):

```tsx
{!dragDisabled && (
  <ResizeHandle
    position="se"
    onMouseDown={(e) => {
      e.stopPropagation();
      onResizeStart(e, 'se');
    }}
  />
)}
```

- [ ] **Step 2: Create `src/renderer/layout/GridLayout.tsx`**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '../state/canvasStore';
import { PanelView } from '../Panel';
import { SplitTree } from '../../shared/types';
import { rectsFromTree, findLeafPath } from './splitTree';
import { SplitDivider } from './SplitDivider';

interface DividerDescriptor {
  path: number[];
  dir: 'h' | 'v';
  position: number;
  from: number;
  to: number;
  containerSize: number;
  containerStart: number;
}

function collectDividers(
  tree: SplitTree,
  rect: { x: number; y: number; w: number; h: number },
  path: number[] = []
): DividerDescriptor[] {
  if (tree.kind === 'leaf') return [];
  const out: DividerDescriptor[] = [];
  if (tree.dir === 'v') {
    const w = Math.round(rect.w * tree.ratio);
    out.push({
      path,
      dir: 'v',
      position: rect.x + w,
      from: rect.y,
      to: rect.y + rect.h,
      containerSize: rect.w,
      containerStart: rect.x,
    });
    out.push(...collectDividers(tree.a, { x: rect.x, y: rect.y, w, h: rect.h }, [...path, 0]));
    out.push(...collectDividers(tree.b, { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }, [...path, 1]));
  } else {
    const h = Math.round(rect.h * tree.ratio);
    out.push({
      path,
      dir: 'h',
      position: rect.y + h,
      from: rect.x,
      to: rect.x + rect.w,
      containerSize: rect.h,
      containerStart: rect.y,
    });
    out.push(...collectDividers(tree.a, { x: rect.x, y: rect.y, w: rect.w, h }, [...path, 0]));
    out.push(...collectDividers(tree.b, { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h }, [...path, 1]));
  }
  return out;
}

export const GridLayout: React.FC = () => {
  const panels = useCanvasStore((s) => s.panels);
  const gridTree = useCanvasStore((s) => s.gridTree);
  const selectedPanelIds = useCanvasStore((s) => s.selectedPanelIds);
  const focusPanel = useCanvasStore((s) => s.focusPanel);

  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo(() => {
    if (!gridTree) return new Map<string, { x: number; y: number; w: number; h: number }>();
    return rectsFromTree(gridTree, { x: 0, y: 0, w: size.w, h: size.h });
  }, [gridTree, size]);

  const dividers = useMemo(() => {
    if (!gridTree) return [];
    return collectDividers(gridTree, { x: 0, y: 0, w: size.w, h: size.h });
  }, [gridTree, size]);

  return (
    <div
      ref={rootRef}
      className="canvas-root grid-layout"
      style={{
        position: 'fixed',
        top: 28, // below titlebar
        left: 0,
        right: 0,
        bottom: 0,
        background: '#0f0f0f',
        overflow: 'hidden',
      }}
    >
      {!gridTree && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#666',
            fontSize: 13,
          }}
        >
          Right-click to add a panel
        </div>
      )}

      {gridTree && panels.map((panel) => {
        const r = rects.get(panel.id);
        if (!r) return null;
        return (
          <PanelView
            key={panel.id}
            panel={panel}
            isSelected={selectedPanelIds.includes(panel.id)}
            onFocus={() => focusPanel(panel.id)}
            onDragStart={() => {}}
            onResizeStart={() => {}}
            geometryOverride={{ x: r.x, y: r.y, width: r.w, height: r.h }}
            dragDisabled
          />
        );
      })}

      {dividers.map((d, i) => (
        <SplitDivider
          key={`${d.path.join('-')}-${d.dir}-${i}`}
          path={d.path}
          dir={d.dir}
          position={d.position}
          from={d.from}
          to={d.to}
          containerSize={d.containerSize}
          containerStart={d.containerStart}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/layout/GridLayout.tsx src/renderer/Panel.tsx
git commit -m "$(cat <<'EOF'
layout: GridLayout renders tree to tiled panels + dividers

PanelView now accepts geometryOverride and dragDisabled props so
the same panel chrome works in both modes. GridLayout subscribes
to its container's ResizeObserver to re-tile on window changes.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 8: Branch `Canvas.tsx` on `layoutMode`

**Files:**
- Modify: `src/renderer/Canvas.tsx`

- [ ] **Step 1: Add the branch**

In `src/renderer/Canvas.tsx`, add to the imports:

```tsx
import { GridLayout } from './layout/GridLayout';
```

After the `panels` selector (after line 31), add:

```tsx
const layoutMode = useCanvasStore((s) => s.layoutMode);
```

Just after the `Canvas` function opens (after line 17) — actually right before the final `return` (line 250), add:

```tsx
if (layoutMode === 'grid') {
  return <GridLayout />;
}
```

- [ ] **Step 2: Manual sanity check**

Run: `npm run dev` (or check the dev server already running)
Open the app. In the dev console:

```js
useCanvasStore.getState().setLayoutMode('grid');
```

Expected: canvas swaps to grid layout, panels tile. Switch back:

```js
useCanvasStore.getState().setLayoutMode('canvas');
```

Expected: panels return to floating, viewport preserved.

Stop the dev server if you started a new one for this check.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/Canvas.tsx
git commit -m "$(cat <<'EOF'
canvas: branch on layoutMode to render GridLayout

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 9: Integrate `SnapEngine` into canvas-mode drag

**Files:**
- Modify: `src/renderer/Canvas.tsx`
- Create: `src/renderer/layout/SnapGuides.tsx`

- [ ] **Step 1: Create `src/renderer/layout/SnapGuides.tsx`**

```tsx
import React from 'react';
import { SnapGuide } from './snapEngine';
import { Viewport } from '../../shared/types';

interface SnapGuidesProps {
  guides: SnapGuide[];
  viewport: Viewport;
}

export const SnapGuides: React.FC<SnapGuidesProps> = ({ guides, viewport }) => {
  return (
    <>
      {guides.map((g, i) => {
        const isX = g.axis === 'x';
        const screenPos = isX
          ? (g.position - viewport.x) * viewport.zoom
          : (g.position - viewport.y) * viewport.zoom;
        const screenFrom = isX
          ? (g.from - viewport.y) * viewport.zoom
          : (g.from - viewport.x) * viewport.zoom;
        const screenTo = isX
          ? (g.to - viewport.y) * viewport.zoom
          : (g.to - viewport.x) * viewport.zoom;
        const style: React.CSSProperties = isX
          ? {
              position: 'absolute',
              left: screenPos,
              top: Math.min(screenFrom, screenTo),
              height: Math.abs(screenTo - screenFrom),
              width: 1,
              background: 'rgba(139, 92, 246, 0.8)',
              pointerEvents: 'none',
              zIndex: 9999,
            }
          : {
              position: 'absolute',
              top: screenPos,
              left: Math.min(screenFrom, screenTo),
              width: Math.abs(screenTo - screenFrom),
              height: 1,
              background: 'rgba(139, 92, 246, 0.8)',
              pointerEvents: 'none',
              zIndex: 9999,
            };
        return <div key={i} style={style} />;
      })}
    </>
  );
};
```

- [ ] **Step 2: Wire snap into Canvas.tsx drag handler**

In `src/renderer/Canvas.tsx`, update imports:

```tsx
import { GridLayout } from './layout/GridLayout';
import { snap, SnapGuide } from './layout/snapEngine';
import { SnapGuides } from './layout/SnapGuides';
```

Add state for active guides (near the `contextMenu` state, around line 42):

```tsx
const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
const cmdHeldRef = useRef(false);
```

Track Cmd key (add inside an existing keyboard `useEffect` block, around line 95):

```tsx
const handleKeyDown = (e: KeyboardEvent) => { if (e.metaKey || e.ctrlKey) cmdHeldRef.current = true; };
const handleKeyUp = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey) cmdHeldRef.current = false; };
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
```

Remember to remove these listeners in the cleanup return.

Modify the mouse-move handler `else if (drag.type === 'move' && drag.panelId)` block (around line 165) to call snap:

```tsx
} else if (drag.type === 'move' && drag.panelId) {
  const rawX = (drag.startPanelX ?? 0) + dx / viewport.zoom;
  const rawY = (drag.startPanelY ?? 0) + dy / viewport.zoom;
  const draggedPanel = panels.find((p) => p.id === drag.panelId);
  if (!draggedPanel) return;
  const otherRects = panels
    .filter((p) => p.id !== drag.panelId)
    .map((p) => ({ x: p.position.x, y: p.position.y, w: p.size.width, h: p.size.height }));
  const viewportRect = {
    x: viewport.x,
    y: viewport.y,
    w: window.innerWidth / viewport.zoom,
    h: window.innerHeight / viewport.zoom,
  };
  const result = snap({
    dragRect: { x: rawX, y: rawY, w: draggedPanel.size.width, h: draggedPanel.size.height },
    otherRects,
    viewportRect,
    zoom: viewport.zoom,
    thresholdPx: 8,
    disabled: cmdHeldRef.current,
  });
  setSnapGuides(result.guides);
  movePanel(drag.panelId, { x: result.rect.x, y: result.rect.y });
}
```

In the mouseup handler (around line 176), clear the guides:

```tsx
const handleMouseUp = () => {
  dragStateRef.current = { type: null, startX: 0, startY: 0 };
  setSnapGuides([]);
};
```

Render the overlay at the end of the canvas JSX (just before the closing `</div>` of `.canvas-root`, around line 316):

```tsx
<SnapGuides guides={snapGuides} viewport={viewport} />
```

Note: the guides need to be inside the transformed inner div so they share coordinates. Place them as the last child of the transformed div (after `{sortedPanels.map(...)}`, before the closing `</div>`).

Actually re-read: SnapGuides positions in viewport-pixel coords (it computes `(g.position - viewport.x) * viewport.zoom`), so they must be **outside** the transformed div. Render them as a sibling of the transformed div, inside `.canvas-root`.

- [ ] **Step 3: Manual sanity check**

Run the dev server. In canvas mode, add two panels, then drag one toward the other. Expect a thin purple guide line at the snap target and the dragged panel snapping into alignment.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/Canvas.tsx src/renderer/layout/SnapGuides.tsx
git commit -m "$(cat <<'EOF'
canvas: magnetic snap during drag

SnapEngine wired into the move handler. Purple guide overlay
renders during drag, clears on mouseup. ⌘ held disables snap.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 10: Create `LayoutModeToggle` and wire ⌘⇧L

**Files:**
- Create: `src/renderer/layout/LayoutModeToggle.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the toggle component**

```tsx
import React from 'react';
import { useCanvasStore } from '../state/canvasStore';
import { Tooltip } from '../Tooltip';

export const LayoutModeToggle: React.FC = () => {
  const layoutMode = useCanvasStore((s) => s.layoutMode);
  const setLayoutMode = useCanvasStore((s) => s.setLayoutMode);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    background: active ? '#3a3a3a' : 'transparent',
    color: active ? '#fff' : '#888',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: active ? 500 : 400,
  });

  return (
    <Tooltip label="Toggle layout mode  ⌘⇧L" side="bottom">
      <div
        style={{
          display: 'inline-flex',
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: 2,
          gap: 2,
        }}
      >
        <button
          onClick={() => setLayoutMode('canvas')}
          style={pillStyle(layoutMode === 'canvas')}
          aria-label="Canvas mode"
          aria-pressed={layoutMode === 'canvas'}
        >
          Canvas
        </button>
        <button
          onClick={() => setLayoutMode('grid')}
          style={pillStyle(layoutMode === 'grid')}
          aria-label="Grid mode"
          aria-pressed={layoutMode === 'grid'}
        >
          Grid
        </button>
      </div>
    </Tooltip>
  );
};
```

- [ ] **Step 2: Mount it in the TitleBar**

In `src/renderer/App.tsx`, add the import:

```tsx
import { LayoutModeToggle } from './layout/LayoutModeToggle';
```

In the `TitleBar` component, replace the `marginLeft: 'auto'` wrapper (around lines 232–234) with:

```tsx
<div style={{ marginLeft: 'auto', WebkitAppRegion: 'no-drag', display: 'flex', gap: 8, alignItems: 'center' }}>
  <LayoutModeToggle />
  <BackgroundPicker mode={background} onChange={onBackgroundChange} />
</div>
```

- [ ] **Step 3: Wire ⌘⇧L in Canvas.tsx**

In the keyboard handler in `Canvas.tsx` (the big `useEffect` around line 94), add another branch after the redo branch:

```tsx
} else if (e.key === 'l' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
  e.preventDefault();
  const current = useCanvasStore.getState().layoutMode;
  useCanvasStore.getState().setLayoutMode(current === 'canvas' ? 'grid' : 'canvas');
}
```

- [ ] **Step 4: Manual sanity check**

Press ⌘⇧L. Verify the title-bar toggle reflects the change and the canvas swaps modes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/layout/LayoutModeToggle.tsx src/renderer/App.tsx src/renderer/Canvas.tsx
git commit -m "$(cat <<'EOF'
layout: mode-toggle UI + ⌘⇧L hotkey

Segmented control in the title bar. ⌘⇧L toggles the active
mode for the current workspace.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 11: Grid-mode keyboard shortcuts (⌘\, ⌘-, ⌘W)

**Files:**
- Modify: `src/renderer/state/canvasStore.ts`
- Modify: `src/renderer/Canvas.tsx`

- [ ] **Step 1: Implement `splitFocused` in the store**

In `src/renderer/state/canvasStore.ts`, replace the `splitFocused` stub:

```ts
splitFocused: (dir, newPanel) => {
  const s = get();
  if (s.layoutMode !== 'grid' || !s.gridTree) return;
  const focusedId = s.selectedPanelIds[0] ?? firstLeaf(s.gridTree);
  if (!focusedId) return;
  pushHistory();
  const tree = splitLeaf(s.gridTree, focusedId, newPanel.id, dir);
  maxZOrder += 1;
  const panel = { ...newPanel, zOrder: maxZOrder };
  set({
    panels: [...s.panels, panel],
    gridTree: tree,
    selectedPanelIds: [panel.id],
    isDirty: true,
  });
},
```

- [ ] **Step 2: Implement `closeLeaf` in the store**

Replace the `closeLeaf` stub:

```ts
closeLeaf: (panelId) => {
  const s = get();
  if (s.layoutMode !== 'grid') return;
  pushHistory();
  set((curr) => {
    const tree = curr.gridTree ? removeLeafTree(curr.gridTree, panelId) ?? undefined : undefined;
    return {
      panels: curr.panels.filter((p) => p.id !== panelId),
      selectedPanelIds: curr.selectedPanelIds.filter((id) => id !== panelId),
      gridTree: tree,
      isDirty: true,
    };
  });
},
```

Update the import to include `removeLeaf` aliased:

```ts
import {
  allLeaves,
  firstLeaf,
  rectsFromTree,
  resizeDivider as resizeDividerTree,
  removeLeaf as removeLeafTree,
  splitLeaf,
} from '../layout/splitTree';
```

Also patch `deletePanel` so it routes through `closeLeaf` when in grid mode:

```ts
deletePanel: (id) => {
  const s = get();
  if (s.layoutMode === 'grid') {
    get().closeLeaf(id);
    return;
  }
  pushHistory();
  set((curr) => ({
    panels: curr.panels.filter((p) => p.id !== id),
    selectedPanelIds: curr.selectedPanelIds.filter((pid) => pid !== id),
    isDirty: true,
  }));
},
```

- [ ] **Step 3: Wire the shortcuts in Canvas.tsx**

In the keyboard `useEffect` in `Canvas.tsx`, add (after the ⌘⇧L branch):

```tsx
} else if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
  e.preventDefault();
  const s = useCanvasStore.getState();
  if (s.layoutMode === 'grid') {
    // For now we split with a terminal panel as a sensible default.
    // The "choose panel type" picker can come later — same factory used
    // by the context menu does the job here.
    const newPanel = createPanelOfType('terminal', 0, 0);
    s.splitFocused('v', newPanel);
  }
} else if (e.key === '-' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
  // Only treat as split-down in grid mode; otherwise it remains zoom-out
  const s = useCanvasStore.getState();
  if (s.layoutMode === 'grid') {
    e.preventDefault();
    const newPanel = createPanelOfType('terminal', 0, 0);
    s.splitFocused('h', newPanel);
    return;
  }
  // (the existing ⌘- zoom-out branch is reached when not in grid mode)
}
```

The existing ⌘- branch (line 112–113) handles zoom-out in canvas mode and stays as-is — the new branch returns early for grid mode.

- [ ] **Step 4: Manual sanity check**

In grid mode, press ⌘\ — a new terminal appears, right-split. Press ⌘- — a new terminal appears, bottom-split. Close one of them — its sibling absorbs the space.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/canvasStore.ts src/renderer/Canvas.tsx
git commit -m "$(cat <<'EOF'
grid: ⌘\\ split-right, ⌘- split-down, ⌘W close

deletePanel routes through closeLeaf in grid mode so the split
tree stays consistent. Split shortcuts default to a terminal
panel; a panel-type picker is a phase-2 nicety.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 12: E2E tests for layout modes

**Files:**
- Modify: `tests/e2e/canvas.spec.ts`

- [ ] **Step 1: Append e2e tests**

At the end of `tests/e2e/canvas.spec.ts`, add:

```ts
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

  const before = await window.evaluate(() => {
    const store = (window as any).__canvasStore;
    return store ? store.getState().layoutMode : null;
  });

  // Note: in real e2e we trigger via keyboard, but a deterministic alternative
  // is to call setLayoutMode through the store directly. Here we use the
  // keyboard path:
  await window.keyboard.press('Meta+Shift+l');
  await window.waitForTimeout(200);

  const afterMode = await window.evaluate(() => {
    return document.querySelector('.grid-layout') ? 'grid' : 'canvas';
  });

  expect(afterMode).toBe(before === 'canvas' ? 'grid' : 'canvas');

  await app.close();
});

test('grid mode tiles panels and switching back restores floating layout', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.canvas-root', { timeout: 15_000 });
  await window.waitForFunction(() => !!(window as any).canvasAPI?.loadCanvas, undefined, { timeout: 15_000 });

  // Add two panels via right-click → Terminal twice
  for (let i = 0; i < 2; i++) {
    await window.evaluate(() => {
      const canvas = document.querySelector('.canvas-root') as HTMLElement | null;
      if (!canvas) throw new Error('no canvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: rect.left + rect.width / 2 + i * 50,
          clientY: rect.top + rect.height / 2 + i * 50,
        })
      );
    });
    await window.getByText('Terminal', { exact: true }).first().click();
    await window.waitForTimeout(300);
  }

  // Toggle to grid
  await window.getByRole('button', { name: 'Grid mode' }).click();
  await window.waitForSelector('.grid-layout');

  // Both panels should be visible inside the grid
  const panelCount = await window.locator('.grid-layout .panel').count();
  expect(panelCount).toBe(2);

  // Toggle back to canvas
  await window.getByRole('button', { name: 'Canvas mode' }).click();
  await window.waitForFunction(() => !document.querySelector('.grid-layout'));

  // Panels still there
  const canvasPanelCount = await window.locator('.canvas-root .panel').count();
  expect(canvasPanelCount).toBe(2);

  await app.close();
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: all e2e tests pass, including the three new ones.

If the first new test fails because `__canvasStore` isn't exposed: replace that block with a DOM-based check (we already do this in test 3). Edit accordingly.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/canvas.spec.ts
git commit -m "$(cat <<'EOF'
test: e2e for layout-mode toggle and grid tiling

Three new e2e cases cover the title-bar toggle, the ⌘⇧L
hotkey, and panel preservation across mode switches.

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Task 13: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Layout Modes section to the README**

In `README.md`, add a new section between "Features" and "Running it":

```markdown
## Layout modes

Two modes per workspace, toggled from the title bar or with `⌘⇧L`:

- **Canvas** (default) — infinite pan/zoom canvas. Drag a panel near another
  panel's edge or the viewport edge to snap into alignment; a thin purple
  guide line shows the snap target. Hold `⌘` while dragging to disable
  snapping for one drag.
- **Grid** — VS Code-style binary-split tiling. Panels fill the viewport
  with no overlap and no gaps.
  - `⌘\` splits the focused panel right
  - `⌘-` splits the focused panel down
  - `⌘W` closes the focused panel (sibling absorbs its space)
  - Drag a divider to resize both neighbours

Switching modes preserves panel identity, so PTYs keep running, editors
keep their buffers, and webviews keep their pages. Geometry reflows.
```

Update the keyboard-shortcuts table to add the new bindings:

```markdown
| ⌘⇧L              | Toggle layout mode                  |
| ⌘ (held)         | Disable snap while dragging (canvas)|
| ⌘\               | Split right (grid)                  |
| ⌘-               | Split down (grid) / Zoom out (canvas)|
| ⌘W               | Close panel (grid)                  |
```

Update the test counts in the "Tests" section to reflect new tests (run `npm test` and `npm run test:e2e` first to get exact numbers, then update).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README — layout modes section and shortcuts

Co-authored-by: Zippy AI <tomkinsbale@icloud.com>
EOF
)"
```

---

## Self-Review Checklist

After running each task, verify before moving on:
- Did the tests run? Did they fail before the implementation and pass after?
- Did the commit happen?
- Did `npx tsc --noEmit` pass?

Final sweep after Task 13:
- `npm test` — all unit tests pass
- `npm run test:e2e` — all e2e tests pass
- `npm run dev` — manually toggle modes a few times, drag with snap, split in grid, switch workspaces and verify mode persists per workspace.
