import React, { useCallback, useRef, useState } from 'react';
import { useCanvasStore } from '../state/canvasStore';

interface SplitDividerProps {
  path: number[];
  dir: 'h' | 'v';
  position: number;
  from: number;
  to: number;
  containerSize: number;
  containerStart: number;
}

const DIVIDER_THICKNESS = 4;
const HIT_PADDING = 2;

export const SplitDivider: React.FC<SplitDividerProps> = ({
  path,
  dir,
  position,
  from,
  to,
  containerSize,
  containerStart,
}) => {
  const resizeDivider = useCanvasStore((s) => s.resizeDivider);
  const [hover, setHover] = useState(false);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    // dir 'v' = vertical divider line, drag in X changes the ratio
    const pointer = dir === 'v' ? e.clientX : e.clientY;
    const ratio = (pointer - containerStart) / containerSize;
    resizeDivider(path, ratio);
  }, [dir, containerSize, containerStart, path, resizeDivider]);

  const style: React.CSSProperties = dir === 'v'
    ? {
        position: 'absolute',
        left: position - DIVIDER_THICKNESS / 2 - HIT_PADDING,
        top: from,
        width: DIVIDER_THICKNESS + HIT_PADDING * 2,
        height: to - from,
        cursor: 'col-resize',
        background: hover || draggingRef.current ? 'rgba(139, 92, 246, 0.4)' : 'transparent',
        transition: 'background 120ms',
        zIndex: 10,
      }
    : {
        position: 'absolute',
        top: position - DIVIDER_THICKNESS / 2 - HIT_PADDING,
        left: from,
        height: DIVIDER_THICKNESS + HIT_PADDING * 2,
        width: to - from,
        cursor: 'row-resize',
        background: hover || draggingRef.current ? 'rgba(139, 92, 246, 0.4)' : 'transparent',
        transition: 'background 120ms',
        zIndex: 10,
      };

  return (
    <div
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
};
