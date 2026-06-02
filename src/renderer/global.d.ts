import type { CanvasAPI } from '../preload';

declare global {
  interface Window {
    canvasAPI: CanvasAPI;
  }
}
