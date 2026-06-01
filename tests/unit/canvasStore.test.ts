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
