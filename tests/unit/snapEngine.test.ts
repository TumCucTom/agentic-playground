import { describe, it, expect } from 'vitest';
import { snap } from '../../src/renderer/layout/snapEngine';

const baseInput = {
  dragRect: { x: 100, y: 100, w: 200, h: 100 },
  // Y is offset to 250 so the drag has no incidental Y alignment with this panel.
  otherRects: [{ x: 400, y: 250, w: 200, h: 100 }],
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
