// Dimensions of the chrome that the canvas/grid layouts sit under.
// The Toolbox sidebar is `width` 56 and starts below the title bar.
// The title bar is 28px tall. Both are fixed-position overlays from
// src/renderer/Toolbox.tsx and src/renderer/App.tsx.

export const SIDEBAR_WIDTH = 56;
export const TITLE_BAR_HEIGHT = 28;

// Convenience: the rectangle inside the chrome that panels and grid
// cells can actually use. Origin is window top-left; x/y is in CSS
// pixels.
export const CANVAS_BOUNDS = {
  x: SIDEBAR_WIDTH,
  y: TITLE_BAR_HEIGHT,
  width: () => window.innerWidth - SIDEBAR_WIDTH,
  height: () => window.innerHeight - TITLE_BAR_HEIGHT,
};
