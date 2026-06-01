import { create } from 'zustand';
import { CanvasState, Panel, PanelPosition, Viewport, LayoutMode, SplitTree } from '../../shared/types';
import {
  allLeaves,
  firstLeaf,
  rectsFromTree,
  resizeDivider as resizeDividerTree,
  removeLeaf as removeLeafTree,
  splitLeaf,
} from '../layout/splitTree';

const MAX_HISTORY = 50;
const HISTORY_COALESCE_MS = 100;

interface HistoryEntry {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
  layoutMode: LayoutMode;
  gridTree?: SplitTree;
  timestamp: number;
}

export interface CanvasStore extends CanvasState {
  isDirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  // Public API
  initialize: (state: CanvasState) => void;
  addPanel: (panel: Panel) => void;
  updatePanel: (id: string, updates: Partial<Panel>) => void;
  movePanel: (id: string, position: PanelPosition) => void;
  resizePanel: (id: string, width: number, height: number) => void;
  focusPanel: (id: string) => void;
  deletePanel: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  panViewport: (dx: number, dy: number) => void;
  zoomViewport: (factor: number, centerX?: number, centerY?: number) => void;
  setPanelState: (id: string, state: 'idle' | 'running') => void;
  applyOneBigNSmall: (ids: string[]) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  splitFocused: (dir: 'h' | 'v', newPanel: Panel) => void;
  resizeDivider: (leafPath: number[], ratio: number) => void;
  closeLeaf: (panelId: string) => void;
  toggleMaximize: (panelId: string) => void;
  markClean: () => void;
  serialize: () => CanvasState;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let maxZOrder = 0;

function cloneTree(tree: SplitTree): SplitTree {
  if (tree.kind === 'leaf') return { kind: 'leaf', panelId: tree.panelId };
  return { kind: 'split', dir: tree.dir, ratio: tree.ratio, a: cloneTree(tree.a), b: cloneTree(tree.b) };
}

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

export const useCanvasStore = create<CanvasStore>((set, get) => {
  // Push current state to `past` and clear `future`. Coalesce rapid
  // mutations (e.g., a drag fires dozens of movePanel calls per second)
  // so they become a single undo step.
  const pushHistory = (): void => {
    const state = get();
    const now = Date.now();
    const last = state.past[state.past.length - 1];
    if (last && now - last.timestamp < HISTORY_COALESCE_MS) {
      // Coalesce: skip pushing a new entry. The first push in the
      // burst captured the pre-mutation state; subsequent mutations
      // within the window share the same undo step.
      return;
    }
    const next = [...state.past, snapshot(state)];
    if (next.length > MAX_HISTORY) next.shift();
    set({ past: next, future: [] });
  };

  return {
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

    addPanel: (panel) => {
      pushHistory();
      maxZOrder += 1;
      const newPanel = { ...panel, zOrder: maxZOrder };
      set((s) => ({
        panels: [...s.panels, newPanel],
        selectedPanelIds: [newPanel.id],
        isDirty: true,
      }));
    },

    updatePanel: (id, updates) => {
      pushHistory();
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        isDirty: true,
      }));
    },

    movePanel: (id, position) => {
      // Move during a drag is high-frequency; we still push history, but
      // the coalesce window collapses them into one step.
      pushHistory();
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, position } : p)),
        isDirty: true,
      }));
    },

    resizePanel: (id, width, height) => {
      pushHistory();
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, size: { width, height } } : p)),
        isDirty: true,
      }));
    },

    focusPanel: (id) => {
      maxZOrder += 1;
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, zOrder: maxZOrder } : p)),
        selectedPanelIds: s.selectedPanelIds.includes(id) ? s.selectedPanelIds : [id, ...s.selectedPanelIds],
      }));
    },

    deletePanel: (id) => {
      const s = get();
      if (s.layoutMode === 'grid') {
        get().closeLeaf(id);
        return;
      }
      pushHistory();
      set((s) => ({
        panels: s.panels.filter((p) => p.id !== id),
        selectedPanelIds: s.selectedPanelIds.filter((pid) => pid !== id),
        isDirty: true,
      }));
    },

    setSelected: (ids) => set({ selectedPanelIds: ids }),

    setViewport: (viewport) => {
      pushHistory();
      set((s) => ({
        viewport: { ...s.viewport, ...viewport },
        isDirty: true,
      }));
    },

    panViewport: (dx, dy) => {
      pushHistory();
      set((s) => ({
        viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
        isDirty: true,
      }));
    },

    zoomViewport: (factor, centerX, centerY) => {
      const { viewport } = get();
      const newZoom = Math.max(0.1, Math.min(4, viewport.zoom * factor));
      if (newZoom === viewport.zoom) return;
      pushHistory();
      let newX = viewport.x;
      let newY = viewport.y;
      if (centerX !== undefined && centerY !== undefined) {
        const canvasX = centerX / viewport.zoom + viewport.x;
        const canvasY = centerY / viewport.zoom + viewport.y;
        newX = canvasX - centerX / newZoom;
        newY = canvasY - centerY / newZoom;
      }
      set({ viewport: { x: newX, y: newY, zoom: newZoom }, isDirty: true });
    },

    setPanelState: (id, state) => {
      pushHistory();
      set((s) => ({
        panels: s.panels.map((p) => (p.id === id ? { ...p, state } : p)),
        isDirty: true,
      }));
    },

    applyOneBigNSmall: (ids) => {
      pushHistory();
      set((s) => {
        const panels = s.panels.filter((p) => ids.includes(p.id));
        if (panels.length < 2) return s;
        // Compute the bounding box of the selected panels
        const minX = Math.min(...panels.map((p) => p.position.x));
        const minY = Math.min(...panels.map((p) => p.position.y));
        const maxX = Math.max(...panels.map((p) => p.position.x + p.size.width));
        const maxY = Math.max(...panels.map((p) => p.position.y + p.size.height));
        const totalW = maxX - minX;
        const totalH = maxY - minY;
        // Big panel takes 70% of the width; small panels stack on the right
        const bigW = Math.max(400, totalW * 0.7);
        const smallW = totalW - bigW - 12;
        const smallPanelH = panels.length > 1 ? (totalH - (panels.length - 2) * 12) / (panels.length - 1) : totalH;
        // First selected is the "big" one; rest are small
        const big = panels[0];
        const small = panels.slice(1);
        const updates = new Map<string, { position: PanelPosition; size: { width: number; height: number } }>();
        updates.set(big.id, {
          position: { x: minX, y: minY },
          size: { width: bigW, height: totalH },
        });
        small.forEach((p, i) => {
          updates.set(p.id, {
            position: { x: minX + bigW + 12, y: minY + i * (smallPanelH + 12) },
            size: { width: smallW, height: smallPanelH },
          });
        });
        return {
          panels: s.panels.map((p) => {
            const u = updates.get(p.id);
            return u ? { ...p, position: u.position, size: u.size } : p;
          }),
          isDirty: true,
        };
      });
    },

    markClean: () => set({ isDirty: false }),

    serialize: () => {
      const { panels, viewport, selectedPanelIds, workspaceName, lastUpdated, layoutMode, gridTree } = get();
      return { panels, viewport, selectedPanelIds, workspaceName, lastUpdated, layoutMode, gridTree };
    },

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
    resizeDivider: (path, ratio) => {
      pushHistory();
      set((s) => {
        if (!s.gridTree) return s;
        return { gridTree: resizeDividerTree(s.gridTree, path, ratio), isDirty: true };
      });
    },
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

    toggleMaximize: (panelId) => {
      const s = get();
      // Maximize is a canvas-mode concept; in grid mode the panel already
      // fills its tile.
      if (s.layoutMode !== 'canvas') return;
      const panel = s.panels.find((p) => p.id === panelId);
      if (!panel) return;
      pushHistory();
      if (panel.maximized && panel.savedPosition && panel.savedSize) {
        set({
          panels: s.panels.map((p) =>
            p.id === panelId
              ? {
                  ...p,
                  position: p.savedPosition!,
                  size: p.savedSize!,
                  maximized: false,
                  savedPosition: undefined,
                  savedSize: undefined,
                }
              : p
          ),
          isDirty: true,
        });
        return;
      }
      const w = window.innerWidth / s.viewport.zoom;
      const h = window.innerHeight / s.viewport.zoom;
      set({
        panels: s.panels.map((p) =>
          p.id === panelId
            ? {
                ...p,
                savedPosition: p.position,
                savedSize: p.size,
                position: { x: s.viewport.x, y: s.viewport.y },
                size: { width: w, height: h },
                maximized: true,
              }
            : p
        ),
        isDirty: true,
      });
    },

    undo: () => {
      const { past } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      const current = snapshot(get());
      const remaining = past.slice(0, -1);
      // Recompute maxZOrder to be at least the new max
      const newMax = previous.panels.reduce((m, p) => Math.max(m, p.zOrder), 0);
      if (newMax > maxZOrder) maxZOrder = newMax;
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
    },

    redo: () => {
      const { future } = get();
      if (future.length === 0) return;
      const next = future[future.length - 1];
      const current = snapshot(get());
      const remaining = future.slice(0, -1);
      const newMax = next.panels.reduce((m, p) => Math.max(m, p.zOrder), 0);
      if (newMax > maxZOrder) maxZOrder = newMax;
      set({
        panels: next.panels,
        viewport: next.viewport,
        selectedPanelIds: next.selectedPanelIds,
        layoutMode: next.layoutMode,
        gridTree: next.gridTree,
        past: [...get().past, current],
        future: remaining,
        isDirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});
