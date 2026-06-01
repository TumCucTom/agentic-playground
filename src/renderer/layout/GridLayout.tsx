import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '../state/canvasStore';
import { PanelView } from '../Panel';
import { SplitTree } from '../../shared/types';
import { rectsFromTree, findRightDividerPath, findBottomDividerPath, findLeftDividerPath, findTopDividerPath } from './splitTree';
import { SplitDivider } from './SplitDivider';
import { SIDEBAR_WIDTH, TITLE_BAR_HEIGHT } from './canvasChrome';

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
  const resizeDivider = useCanvasStore((s) => s.resizeDivider);

  const rootRef = useRef<HTMLDivElement>(null);
  // Size is the panel area inside the chrome (sidebar + title bar).
  // The ResizeObserver below tracks the actual root element size, so
  // this initial value is only used for the first paint.
  const [size, setSize] = useState({
    w: window.innerWidth - SIDEBAR_WIDTH,
    h: window.innerHeight - TITLE_BAR_HEIGHT,
  });

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

  // A descriptor for a divider can be looked up by its JSON path. Used by
  // the SE-handle drag handler to translate pointer motion into ratio
  // changes for the right and bottom dividers of a panel.
  const dividersByPath = useMemo(() => {
    const m = new Map<string, DividerDescriptor>();
    for (const d of dividers) m.set(d.path.join('-') + '-' + d.dir, d);
    return m;
  }, [dividers]);

  const handleResizeStart = (panelId: string) => (e: React.MouseEvent, handle: string) => {
    if (!gridTree) return;
    e.preventDefault();
    // For each direction, look up the divider that controls that edge
    // of the panel. A 'v' split's right edge is the right divider of
    // its `a` child and the left divider of its `b` child; same for
    // 'h' splits. If a panel sits at the root boundary in some
    // direction, no divider exists for that side and the move is a
    // no-op.
    const dirs: Array<'e' | 'w' | 's' | 'n'> = [];
    if (handle === 'e' || handle === 'se' || handle === 'ne') dirs.push('e');
    if (handle === 'w' || handle === 'sw' || handle === 'nw') dirs.push('w');
    if (handle === 's' || handle === 'se' || handle === 'sw') dirs.push('s');
    if (handle === 'n' || handle === 'ne' || handle === 'nw') dirs.push('n');

    const lookups: Array<{ path: number[] | null; dir: 'v' | 'h' }> = dirs.map((d) => {
      if (d === 'e') return { path: findRightDividerPath(gridTree, panelId), dir: 'v' };
      if (d === 'w') return { path: findLeftDividerPath(gridTree, panelId), dir: 'v' };
      if (d === 's') return { path: findBottomDividerPath(gridTree, panelId), dir: 'h' };
      return { path: findTopDividerPath(gridTree, panelId), dir: 'h' };
    });
    const descs = lookups
      .map((l) => (l.path ? dividersByPath.get(l.path.join('-') + '-' + l.dir) ?? null : null))
      .filter((d): d is DividerDescriptor => d !== null);
    if (descs.length === 0) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      for (const desc of descs) {
        // For both directions, the divider is the shared edge
        // between the `a` and `b` children. Dragging the cursor by
        // (dx, dy) translates to a new divider position; the ratio
        // re-derives from that. The panel on the side of the handle
        // the user grabbed grows (or shrinks) accordingly.
        const delta = desc.dir === 'v' ? dx : dy;
        const newPosition = desc.position + delta;
        const newRatio = (newPosition - desc.containerStart) / desc.containerSize;
        resizeDivider(desc.path, newRatio);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // For each panel, which resize directions have a real divider to
  // move? Pass the available set to PanelView so it can hide handles
  // that would no-op (e.g., grabbing the left edge of the leftmost
  // panel in a row).
  const availableHandlesByPanel = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!gridTree) return m;
    for (const panel of panels) {
      const set = new Set<string>();
      if (findRightDividerPath(gridTree, panel.id)) set.add('e');
      if (findLeftDividerPath(gridTree, panel.id)) set.add('w');
      if (findBottomDividerPath(gridTree, panel.id)) set.add('s');
      if (findTopDividerPath(gridTree, panel.id)) set.add('n');
      if (set.has('e') && set.has('s')) set.add('se');
      if (set.has('w') && set.has('s')) set.add('sw');
      if (set.has('e') && set.has('n')) set.add('ne');
      if (set.has('w') && set.has('n')) set.add('nw');
      m.set(panel.id, set);
    }
    return m;
  }, [gridTree, panels]);

  return (
    <div
      ref={rootRef}
      className="canvas-root grid-layout"
      style={{
        position: 'fixed',
        top: TITLE_BAR_HEIGHT,
        // Stop before the left sidebar so panels can't be dragged
        // underneath it.
        left: SIDEBAR_WIDTH,
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
            onResizeStart={handleResizeStart(panel.id)}
            geometryOverride={{ x: r.x, y: r.y, width: r.w, height: r.h }}
            dragDisabled
            availableHandles={availableHandlesByPanel.get(panel.id)}
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
