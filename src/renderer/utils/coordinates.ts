// Coordinate transform utilities

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// Convert viewport pixel coordinates to canvas coordinates
export function viewportToCanvas(
  viewportX: number,
  viewportY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: viewportX / viewport.zoom + viewport.x,
    y: viewportY / viewport.zoom + viewport.y,
  };
}

// Convert canvas coordinates to viewport pixel coordinates
export function canvasToViewport(
  canvasX: number,
  canvasY: number,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: (canvasX - viewport.x) * viewport.zoom,
    y: (canvasY - viewport.y) * viewport.zoom,
  };
}

// Snap a value to the nearest grid line
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

// Clamp zoom to allowed range
export function clampZoom(zoom: number): number {
  return Math.max(0.1, Math.min(4, zoom));
}
