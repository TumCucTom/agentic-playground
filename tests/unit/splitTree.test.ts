import { describe, it, expect } from 'vitest';
import {
  splitLeaf,
  removeLeaf,
  resizeDivider,
  findLeafPath,
  firstLeaf,
  allLeaves,
  rectsFromTree,
} from '../../src/renderer/layout/splitTree';
import { SplitTree } from '../../src/shared/types';

const leaf = (id: string): SplitTree => ({ kind: 'leaf', panelId: id });

describe('splitTree', () => {
  describe('splitLeaf', () => {
    it('splits a leaf into a split node with new panel on side b', () => {
      const tree = leaf('a');
      const result = splitLeaf(tree, 'a', 'b', 'v');
      expect(result).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      });
    });

    it('splits a nested leaf', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const result = splitLeaf(tree, 'b', 'c', 'h');
      expect(result).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      });
    });

    it('returns the tree unchanged when leaf id is not found', () => {
      const tree = leaf('a');
      const result = splitLeaf(tree, 'z', 'b', 'v');
      expect(result).toEqual(tree);
    });
  });

  describe('removeLeaf', () => {
    it('returns null when removing the only leaf', () => {
      expect(removeLeaf(leaf('a'), 'a')).toBeNull();
    });

    it('collapses a split into its surviving sibling', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(removeLeaf(tree, 'a')).toEqual(leaf('b'));
      expect(removeLeaf(tree, 'b')).toEqual(leaf('a'));
    });

    it('returns the tree unchanged when leaf is not found', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(removeLeaf(tree, 'z')).toEqual(tree);
    });

    it('handles deep removal', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      expect(removeLeaf(tree, 'b')).toEqual({
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('c'),
      });
    });
  });

  describe('resizeDivider', () => {
    it('updates the ratio at the given path', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const result = resizeDivider(tree, [], 0.7);
      expect(result).toMatchObject({ ratio: 0.7 });
    });

    it('clamps ratio to [0.05, 0.95]', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect((resizeDivider(tree, [], 0.01) as any).ratio).toBe(0.05);
      expect((resizeDivider(tree, [], 0.99) as any).ratio).toBe(0.95);
    });

    it('updates a nested split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      const result = resizeDivider(tree, [1], 0.3);
      expect(result).toMatchObject({
        a: leaf('a'),
        b: { ratio: 0.3 },
      });
    });
  });

  describe('findLeafPath', () => {
    it('returns empty path for a root leaf', () => {
      expect(findLeafPath(leaf('a'), 'a')).toEqual([]);
    });

    it('returns the path through a nested tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      expect(findLeafPath(tree, 'a')).toEqual([0]);
      expect(findLeafPath(tree, 'b')).toEqual([1, 0]);
      expect(findLeafPath(tree, 'c')).toEqual([1, 1]);
    });

    it('returns null when leaf not present', () => {
      expect(findLeafPath(leaf('a'), 'z')).toBeNull();
    });
  });

  describe('firstLeaf and allLeaves', () => {
    it('finds the leftmost leaf', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('a'), b: leaf('b') },
        b: leaf('c'),
      };
      expect(firstLeaf(tree)).toBe('a');
    });

    it('lists all leaves in left-to-right order', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('a'), b: leaf('b') },
        b: leaf('c'),
      };
      expect(allLeaves(tree)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('rectsFromTree', () => {
    const viewport = { x: 0, y: 0, w: 800, h: 600 };

    it('gives the full rect to a single leaf', () => {
      const rects = rectsFromTree(leaf('a'), viewport);
      expect(rects.get('a')).toEqual(viewport);
    });

    it('splits a vertical divider 50/50 horizontally', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 600 });
      expect(rects.get('b')).toEqual({ x: 400, y: 0, w: 400, h: 600 });
    });

    it('splits a horizontal divider 50/50 vertically', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 800, h: 300 });
      expect(rects.get('b')).toEqual({ x: 0, y: 300, w: 800, h: 300 });
    });

    it('respects non-default ratios', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.25,
        a: leaf('a'),
        b: leaf('b'),
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 200, h: 600 });
      expect(rects.get('b')).toEqual({ x: 200, y: 0, w: 600, h: 600 });
    });

    it('handles a nested tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      const rects = rectsFromTree(tree, viewport);
      expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 400, h: 600 });
      expect(rects.get('b')).toEqual({ x: 400, y: 0, w: 400, h: 300 });
      expect(rects.get('c')).toEqual({ x: 400, y: 300, w: 400, h: 300 });
    });
  });
});
