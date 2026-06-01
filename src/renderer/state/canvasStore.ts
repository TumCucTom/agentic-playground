import { create } from 'zustand';
import { CanvasState, Panel, PanelPosition, Viewport } from '../../shared/types';

const MAX_HISTORY = 50;
const HISTORY_COALESCE_MS = 100;

interface HistoryEntry {
  panels: Panel[];
  viewport: Viewport;
  selectedPanelIds: string[];
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
  markClean: () => void;
  serialize: () => CanvasState;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let maxZOrder = 0;

function snapshot(s: { panels: Panel[]; viewport: Viewport; selectedPanelIds: string[] }): HistoryEntry {
  return {
    panels: s.panels.map((p) => ({ ...p, position: { ...p.position }, size: { ...p.size } })),
    viewport: { ...s.viewport },
    selectedPanelIds: [...s.selectedPanelIds],
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
    isDirty: false,
    past: [],
    future: [],

    initialize: (state) => {
      maxZOrder = state.panels.reduce((max, p) => Math.max(max, p.zOrder), 0);
      set({ ...state, isDirty: false, past: [], future: [] });
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
      const { panels, viewport, selectedPanelIds, workspaceName, lastUpdated } = get();
      return { panels, viewport, selectedPanelIds, workspaceName, lastUpdated };
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
        past: [...get().past, current],
        future: remaining,
        isDirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});
