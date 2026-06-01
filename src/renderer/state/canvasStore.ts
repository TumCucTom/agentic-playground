import { create } from 'zustand';
import { CanvasState, Panel, PanelPosition, Viewport } from '../../shared/types';

export interface CanvasStore extends CanvasState {
  isDirty: boolean;
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
  markClean: () => void;
  serialize: () => CanvasState;
}

let maxZOrder = 0;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  panels: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedPanelIds: [],
  workspaceName: 'default',
  lastUpdated: Date.now(),
  isDirty: false,

  initialize: (state) => {
    maxZOrder = state.panels.reduce((max, p) => Math.max(max, p.zOrder), 0);
    set({
      ...state,
      isDirty: false,
    });
  },

  addPanel: (panel) => {
    maxZOrder += 1;
    const newPanel = { ...panel, zOrder: maxZOrder };
    set((s) => ({
      panels: [...s.panels, newPanel],
      selectedPanelIds: [newPanel.id],
      isDirty: true,
    }));
  },

  updatePanel: (id, updates) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      isDirty: true,
    })),

  movePanel: (id, position) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, position } : p)),
      isDirty: true,
    })),

  resizePanel: (id, width, height) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, size: { width, height } } : p)),
      isDirty: true,
    })),

  focusPanel: (id) => {
    maxZOrder += 1;
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, zOrder: maxZOrder } : p)),
      selectedPanelIds: s.selectedPanelIds.includes(id) ? s.selectedPanelIds : [id, ...s.selectedPanelIds],
    }));
  },

  deletePanel: (id) =>
    set((s) => ({
      panels: s.panels.filter((p) => p.id !== id),
      selectedPanelIds: s.selectedPanelIds.filter((pid) => pid !== id),
      isDirty: true,
    })),

  setSelected: (ids) => set({ selectedPanelIds: ids }),

  setViewport: (viewport) =>
    set((s) => ({
      viewport: { ...s.viewport, ...viewport },
      isDirty: true,
    })),

  panViewport: (dx, dy) =>
    set((s) => ({
      viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
      isDirty: true,
    })),

  zoomViewport: (factor, centerX, centerY) => {
    const { viewport } = get();
    const newZoom = Math.max(0.1, Math.min(4, viewport.zoom * factor));
    if (newZoom === viewport.zoom) return;
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

  setPanelState: (id, state) =>
    set((s) => ({
      panels: s.panels.map((p) => (p.id === id ? { ...p, state } : p)),
      isDirty: true,
    })),

  markClean: () => set({ isDirty: false }),

  serialize: () => {
    const { panels, viewport, selectedPanelIds, workspaceName, lastUpdated } = get();
    return { panels, viewport, selectedPanelIds, workspaceName, lastUpdated };
  },
}));
