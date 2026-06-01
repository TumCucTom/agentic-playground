import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../../src/renderer/state/canvasStore';
import { Panel } from '../../src/shared/types';

// History coalesces rapid actions into one undo step. Wait between
// actions when testing distinct undo steps.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COALESCE_GAP = 120;

function makePanel(id: string, overrides: Partial<Panel> = {}): Panel {
  return {
    id,
    type: 'editor',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    title: `Panel ${id}`,
    state: 'idle',
    zOrder: 1,
    content: { type: 'editor', ref: { filePath: null, language: 'plaintext' } },
    ...overrides,
  };
}

describe('canvas store undo/redo', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      panels: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedPanelIds: [],
      past: [],
      future: [],
    });
  });

  it('records history when adding a panel', () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    expect(useCanvasStore.getState().panels).toHaveLength(1);
    expect(useCanvasStore.getState().past).toHaveLength(1);
  });

  it('undoes the last add', () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().panels).toHaveLength(0);
    expect(useCanvasStore.getState().canUndo()).toBe(false);
    expect(useCanvasStore.getState().canRedo()).toBe(true);
  });

  it('redoes an undone add', () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    useCanvasStore.getState().undo();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().panels).toHaveLength(1);
  });

  it('handles multiple undos', async () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    await wait(COALESCE_GAP);
    useCanvasStore.getState().addPanel(makePanel('b'));
    await wait(COALESCE_GAP);
    useCanvasStore.getState().addPanel(makePanel('c'));
    expect(useCanvasStore.getState().panels).toHaveLength(3);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().panels).toHaveLength(2);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().panels).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().panels).toHaveLength(0);
    expect(useCanvasStore.getState().canUndo()).toBe(false);
  });

  it('clears future on new action', async () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canRedo()).toBe(true);

    await wait(COALESCE_GAP);
    useCanvasStore.getState().addPanel(makePanel('b'));
    expect(useCanvasStore.getState().canRedo()).toBe(false);
  });

  it('records deletion in history', async () => {
    useCanvasStore.getState().addPanel(makePanel('a'));
    await wait(COALESCE_GAP);
    useCanvasStore.getState().deletePanel('a');
    expect(useCanvasStore.getState().panels).toHaveLength(0);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().panels).toHaveLength(1);
    expect(useCanvasStore.getState().panels[0].id).toBe('a');
  });

  it('preserves viewport in history', () => {
    useCanvasStore.getState().setViewport({ x: 100, y: 50, zoom: 1.5 });
    expect(useCanvasStore.getState().viewport.x).toBe(100);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().viewport.x).toBe(0);
  });
});

describe('layout mode defaults', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      panels: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedPanelIds: [],
      past: [],
      future: [],
    });
  });

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
    // Vitest runs in node; the grid→canvas transition reads window size.
    (global as any).window = (global as any).window ?? {};
    (global as any).window.innerWidth = 1024;
    (global as any).window.innerHeight = 768;
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

describe('toggleMaximize', () => {
  beforeEach(() => {
    // Make sure window dimensions are available — toggleMaximize reads them.
    (global as any).window = (global as any).window ?? {};
    (global as any).window.innerWidth = 1024;
    (global as any).window.innerHeight = 768;
    // Set up a fresh store in canvas mode with a single panel.
    useCanvasStore.setState({
      panels: [makePanel('a', { position: { x: 100, y: 100 }, size: { width: 400, height: 300 } })],
      viewport: { x: 50, y: 50, zoom: 1 },
      selectedPanelIds: [],
      past: [],
      future: [],
      layoutMode: 'canvas',
      gridTree: undefined,
    });
  });

  it('stretches the panel to fill the visible canvas and saves its old geometry', () => {
    // window.innerWidth/Height are mocked in vitest setup. Defaults to 1024/768.
    useCanvasStore.getState().toggleMaximize('a');
    const panel = useCanvasStore.getState().panels.find((p) => p.id === 'a')!;
    expect(panel.maximized).toBe(true);
    expect(panel.position).toEqual({ x: 50, y: 50 });
    expect(panel.size).toEqual({ width: 1024, height: 768 });
    expect(panel.savedPosition).toEqual({ x: 100, y: 100 });
    expect(panel.savedSize).toEqual({ width: 400, height: 300 });
  });

  it('restores the panel to its pre-maximize geometry on second call', () => {
    useCanvasStore.getState().toggleMaximize('a');
    useCanvasStore.getState().toggleMaximize('a');
    const panel = useCanvasStore.getState().panels.find((p) => p.id === 'a')!;
    expect(panel.maximized).toBe(false);
    expect(panel.position).toEqual({ x: 100, y: 100 });
    expect(panel.size).toEqual({ width: 400, height: 300 });
    expect(panel.savedPosition).toBeUndefined();
    expect(panel.savedSize).toBeUndefined();
  });

  it('is a no-op in grid mode', () => {
    useCanvasStore.getState().setLayoutMode('grid');
    const before = useCanvasStore.getState().panels[0];
    useCanvasStore.getState().toggleMaximize('a');
    const after = useCanvasStore.getState().panels[0];
    expect(after).toBe(before); // same reference → no change
  });

  it('is a no-op when the panel id is unknown', () => {
    useCanvasStore.getState().toggleMaximize('z');
    const panel = useCanvasStore.getState().panels.find((p) => p.id === 'a')!;
    expect(panel.maximized).toBeUndefined();
  });

  it('respects viewport zoom when computing maximize size', async () => {
    await wait(COALESCE_GAP);
    useCanvasStore.getState().zoomViewport(0.5); // zoom 0.5
    useCanvasStore.getState().toggleMaximize('a');
    const panel = useCanvasStore.getState().panels.find((p) => p.id === 'a')!;
    expect(panel.size).toEqual({ width: 2048, height: 1536 });
  });
});
