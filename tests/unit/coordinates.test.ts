import { describe, it, expect } from 'vitest';
import { viewportToCanvas, canvasToViewport, snapToGrid, clampZoom } from '../../src/renderer/utils/coordinates';

describe('coordinate utilities', () => {
  describe('viewportToCanvas', () => {
    it('converts viewport pixels to canvas coordinates', () => {
      const result = viewportToCanvas(100, 50, { x: 10, y: 20, zoom: 2 });
      // canvasX = 100/2 + 10 = 60
      // canvasY = 50/2 + 20 = 45
      expect(result.x).toBe(60);
      expect(result.y).toBe(45);
    });

    it('handles zoom 1', () => {
      const result = viewportToCanvas(100, 50, { x: 0, y: 0, zoom: 1 });
      expect(result.x).toBe(100);
      expect(result.y).toBe(50);
    });

    it('handles zoom less than 1', () => {
      const result = viewportToCanvas(50, 25, { x: 0, y: 0, zoom: 0.5 });
      expect(result.x).toBe(100);
      expect(result.y).toBe(50);
    });
  });

  describe('canvasToViewport', () => {
    it('converts canvas coordinates to viewport pixels', () => {
      const result = canvasToViewport(60, 45, { x: 10, y: 20, zoom: 2 });
      // viewportX = (60 - 10) * 2 = 100
      // viewportY = (45 - 20) * 2 = 50
      expect(result.x).toBe(100);
      expect(result.y).toBe(50);
    });

    it('round-trips with viewportToCanvas', () => {
      const viewport = { x: 100, y: 50, zoom: 1.5 };
      const canvasPt = viewportToCanvas(200, 150, viewport);
      const back = canvasToViewport(canvasPt.x, canvasPt.y, viewport);
      expect(back.x).toBeCloseTo(200, 5);
      expect(back.y).toBeCloseTo(150, 5);
    });
  });

  describe('snapToGrid', () => {
    it('snaps to nearest grid line', () => {
      expect(snapToGrid(13, 16)).toBe(16);
      expect(snapToGrid(20, 16)).toBe(16);
      expect(snapToGrid(24, 16)).toBe(32);
    });

    it('returns value unchanged when grid size is 0', () => {
      expect(snapToGrid(13, 0)).toBe(13);
    });

    it('handles negative values', () => {
      expect(snapToGrid(-13, 16)).toBe(-16);
    });
  });

  describe('clampZoom', () => {
    it('clamps to min zoom', () => {
      expect(clampZoom(0.01)).toBe(0.1);
    });

    it('clamps to max zoom', () => {
      expect(clampZoom(10)).toBe(4);
    });

    it('passes through valid zoom', () => {
      expect(clampZoom(1.5)).toBe(1.5);
    });
  });
});
