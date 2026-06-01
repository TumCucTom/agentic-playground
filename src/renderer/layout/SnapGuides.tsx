import React from 'react';
import { SnapGuide } from './snapEngine';
import { Viewport } from '../../shared/types';

interface SnapGuidesProps {
  guides: SnapGuide[];
  viewport: Viewport;
}

export const SnapGuides: React.FC<SnapGuidesProps> = ({ guides, viewport }) => {
  return (
    <>
      {guides.map((g, i) => {
        const isX = g.axis === 'x';
        const screenPos = isX
          ? (g.position - viewport.x) * viewport.zoom
          : (g.position - viewport.y) * viewport.zoom;
        const screenFrom = isX
          ? (g.from - viewport.y) * viewport.zoom
          : (g.from - viewport.x) * viewport.zoom;
        const screenTo = isX
          ? (g.to - viewport.y) * viewport.zoom
          : (g.to - viewport.x) * viewport.zoom;
        const style: React.CSSProperties = isX
          ? {
              position: 'absolute',
              left: screenPos,
              top: Math.min(screenFrom, screenTo),
              height: Math.abs(screenTo - screenFrom),
              width: 1,
              background: 'rgba(139, 92, 246, 0.8)',
              pointerEvents: 'none',
              zIndex: 9999,
            }
          : {
              position: 'absolute',
              top: screenPos,
              left: Math.min(screenFrom, screenTo),
              width: Math.abs(screenTo - screenFrom),
              height: 1,
              background: 'rgba(139, 92, 246, 0.8)',
              pointerEvents: 'none',
              zIndex: 9999,
            };
        return <div key={i} style={style} />;
      })}
    </>
  );
};
