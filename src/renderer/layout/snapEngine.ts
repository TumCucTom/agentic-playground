export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

export interface SnapInput {
  dragRect: Rect;
  otherRects: Rect[];
  viewportRect: Rect;
  zoom: number;
  thresholdPx: number;
  disabled: boolean;
}

export interface SnapOutput {
  rect: Rect;
  guides: SnapGuide[];
}

interface AxisTarget {
  position: number;
  guideFrom: number;
  guideTo: number;
}

export function snap(input: SnapInput): SnapOutput {
  if (input.disabled) {
    return { rect: input.dragRect, guides: [] };
  }

  const { dragRect, otherRects, viewportRect, zoom, thresholdPx } = input;
  const thresholdCanvas = thresholdPx / zoom;

  // Candidate X-axis target lines (positions). Each can attract dragLeft,
  // dragRight, or dragCenterX.
  const xTargets: AxisTarget[] = [];
  // Viewport edges + center
  xTargets.push(target(viewportRect.x, viewportRect.y, viewportRect.y + viewportRect.h));
  xTargets.push(target(viewportRect.x + viewportRect.w, viewportRect.y, viewportRect.y + viewportRect.h));
  xTargets.push(target(viewportRect.x + viewportRect.w / 2, viewportRect.y, viewportRect.y + viewportRect.h));
  // Other panel edges + center
  for (const o of otherRects) {
    xTargets.push(target(o.x, o.y, o.y + o.h));
    xTargets.push(target(o.x + o.w, o.y, o.y + o.h));
    xTargets.push(target(o.x + o.w / 2, o.y, o.y + o.h));
  }

  const yTargets: AxisTarget[] = [];
  yTargets.push(target(viewportRect.y, viewportRect.x, viewportRect.x + viewportRect.w));
  yTargets.push(target(viewportRect.y + viewportRect.h, viewportRect.x, viewportRect.x + viewportRect.w));
  yTargets.push(target(viewportRect.y + viewportRect.h / 2, viewportRect.x, viewportRect.x + viewportRect.w));
  for (const o of otherRects) {
    yTargets.push(target(o.y, o.x, o.x + o.w));
    yTargets.push(target(o.y + o.h, o.x, o.x + o.w));
    yTargets.push(target(o.y + o.h / 2, o.x, o.x + o.w));
  }

  // Try to snap dragLeft, dragRight, dragCenterX to any xTarget.
  const dragLeft = dragRect.x;
  const dragRight = dragRect.x + dragRect.w;
  const dragCenterX = dragRect.x + dragRect.w / 2;
  const xPick = pickBest(
    [
      { dragSide: 'left', dragValue: dragLeft },
      { dragSide: 'right', dragValue: dragRight },
      { dragSide: 'center', dragValue: dragCenterX },
    ],
    xTargets,
    thresholdCanvas
  );

  const dragTop = dragRect.y;
  const dragBottom = dragRect.y + dragRect.h;
  const dragCenterY = dragRect.y + dragRect.h / 2;
  const yPick = pickBest(
    [
      { dragSide: 'top', dragValue: dragTop },
      { dragSide: 'bottom', dragValue: dragBottom },
      { dragSide: 'center', dragValue: dragCenterY },
    ],
    yTargets,
    thresholdCanvas
  );

  const guides: SnapGuide[] = [];
  let outX = dragRect.x;
  let outY = dragRect.y;

  if (xPick) {
    if (xPick.dragSide === 'left') outX = xPick.target.position;
    else if (xPick.dragSide === 'right') outX = xPick.target.position - dragRect.w;
    else outX = xPick.target.position - dragRect.w / 2;
    guides.push({
      axis: 'x',
      position: xPick.target.position,
      from: xPick.target.guideFrom,
      to: xPick.target.guideTo,
    });
  }
  if (yPick) {
    if (yPick.dragSide === 'top') outY = yPick.target.position;
    else if (yPick.dragSide === 'bottom') outY = yPick.target.position - dragRect.h;
    else outY = yPick.target.position - dragRect.h / 2;
    guides.push({
      axis: 'y',
      position: yPick.target.position,
      from: yPick.target.guideFrom,
      to: yPick.target.guideTo,
    });
  }

  return {
    rect: { x: outX, y: outY, w: dragRect.w, h: dragRect.h },
    guides,
  };

  function target(position: number, guideFrom: number, guideTo: number): AxisTarget {
    return { position, guideFrom, guideTo };
  }
}

function pickBest(
  dragSides: Array<{ dragSide: string; dragValue: number }>,
  targets: AxisTarget[],
  threshold: number
): { dragSide: string; target: AxisTarget } | null {
  let best: { dragSide: string; target: AxisTarget; distance: number } | null = null;
  for (const ds of dragSides) {
    for (const t of targets) {
      const d = Math.abs(ds.dragValue - t.position);
      if (d <= threshold && (!best || d < best.distance)) {
        best = { dragSide: ds.dragSide, target: t, distance: d };
      }
    }
  }
  return best ? { dragSide: best.dragSide, target: best.target } : null;
}
