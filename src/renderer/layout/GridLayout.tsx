import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '../state/canvasStore';
import { PanelView } from '../Panel';
import { SplitTree } from '../../shared/types';
import { rectsFromTree, findRightDividerPath, findBottomDividerPath } from './splitTree';
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
  const resizeDivider = useCanvasStore((s) => s.resizeDivider);

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

  // A descriptor for a divider can be looked up by its JSON path. Used by
  // the SE-handle drag handler to translate pointer motion into ratio
  // changes for the right and bottom dividers of a panel.
  const dividersByPath = useMemo(() => {
    const m = new Map<string, DividerDescriptor>();
    for (const d of dividers) m.set(d.path.join('-') + '-' + d.dir, d);
    return m;
  }, [dividers]);

  const handleResizeStart = (panelId: string) => (e: React.MouseEvent, handle: string) => {
    if (handle !== 'se') return;
    if (!gridTree) return;
    e.preventDefault();
    const rightPath = findRightDividerPath(gridTree, panelId);
    const bottomPath = findBottomDividerPath(gridTree, panelId);
    if (!rightPath && !bottomPath) return;
    const rightDesc = rightPath ? dividersByPath.get(rightPath.join('-') + '-v') ?? null : null;
    const bottomDesc = bottomPath ? dividersByPath.get(bottomPath.join('-') + '-h') ?? null : null;
    if (!rightDesc && !bottomDesc) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (rightDesc) {
        const newPosition = rightDesc.position + dx;
        const newRatio = (newPosition - rightDesc.containerStart) / rightDesc.containerSize;
        resizeDivider(rightDesc.path, newRatio);
      }
      if (bottomDesc) {
        const newPosition = bottomDesc.position + dy;
        const newRatio = (newPosition - bottomDesc.containerStart) / bottomDesc.containerSize;
        resizeDivider(bottomDesc.path, newRatio);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={rootRef}
      className="canvas-root grid-layout"
      style={{
        position: 'fixed',
        top: 28,
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
            onResizeStart={handleResizeStart(panel.id)}
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
