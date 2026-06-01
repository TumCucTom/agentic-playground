import { SplitTree } from '../../shared/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_RATIO = 0.05;
const MAX_RATIO = 0.95;

export function splitLeaf(
  tree: SplitTree,
  panelId: string,
  newPanelId: string,
  dir: 'h' | 'v'
): SplitTree {
  if (tree.kind === 'leaf') {
    if (tree.panelId !== panelId) return tree;
    return {
      kind: 'split',
      dir,
      ratio: 0.5,
      a: { kind: 'leaf', panelId },
      b: { kind: 'leaf', panelId: newPanelId },
    };
  }
  return {
    ...tree,
    a: splitLeaf(tree.a, panelId, newPanelId, dir),
    b: splitLeaf(tree.b, panelId, newPanelId, dir),
  };
}

export function removeLeaf(tree: SplitTree, panelId: string): SplitTree | null {
  if (tree.kind === 'leaf') {
    return tree.panelId === panelId ? null : tree;
  }
  const a = removeLeaf(tree.a, panelId);
  const b = removeLeaf(tree.b, panelId);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return { ...tree, a, b };
}

export function resizeDivider(tree: SplitTree, path: number[], newRatio: number): SplitTree {
  const clamped = Math.max(MIN_RATIO, Math.min(MAX_RATIO, newRatio));
  if (path.length === 0) {
    if (tree.kind !== 'split') return tree;
    return { ...tree, ratio: clamped };
  }
  if (tree.kind !== 'split') return tree;
  const [head, ...rest] = path;
  if (head === 0) return { ...tree, a: resizeDivider(tree.a, rest, newRatio) };
  return { ...tree, b: resizeDivider(tree.b, rest, newRatio) };
}

export function findLeafPath(tree: SplitTree, panelId: string): number[] | null {
  if (tree.kind === 'leaf') {
    return tree.panelId === panelId ? [] : null;
  }
  const a = findLeafPath(tree.a, panelId);
  if (a !== null) return [0, ...a];
  const b = findLeafPath(tree.b, panelId);
  if (b !== null) return [1, ...b];
  return null;
}

export function firstLeaf(tree: SplitTree): string | null {
  if (tree.kind === 'leaf') return tree.panelId;
  return firstLeaf(tree.a);
}

export function allLeaves(tree: SplitTree): string[] {
  if (tree.kind === 'leaf') return [tree.panelId];
  return [...allLeaves(tree.a), ...allLeaves(tree.b)];
}

export function rectsFromTree(tree: SplitTree, viewport: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>();
  walk(tree, viewport);
  return out;

  function walk(node: SplitTree, rect: Rect): void {
    if (node.kind === 'leaf') {
      out.set(node.panelId, rect);
      return;
    }
    if (node.dir === 'v') {
      const w = Math.round(rect.w * node.ratio);
      walk(node.a, { x: rect.x, y: rect.y, w, h: rect.h });
      walk(node.b, { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h });
    } else {
      const h = Math.round(rect.h * node.ratio);
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h });
      walk(node.b, { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h });
    }
  }
}
