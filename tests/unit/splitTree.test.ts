import { describe, it, expect } from 'vitest';
import {
  splitLeaf,
  removeLeaf,
  resizeDivider,
  findLeafPath,
  firstLeaf,
  allLeaves,
  rectsFromTree,
  getNodeAtPath,
  findRightDividerPath,
  findBottomDividerPath,
  findLeftDividerPath,
  findTopDividerPath,
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

  describe('getNodeAtPath', () => {
    it('returns the root for an empty path', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(getNodeAtPath(tree, [])).toBe(tree);
    });

    it('descends by index to a leaf', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: { kind: 'split', dir: 'h', ratio: 0.5, a: leaf('b'), b: leaf('c') },
      };
      expect(getNodeAtPath(tree, [0])).toEqual(leaf('a'));
      expect(getNodeAtPath(tree, [1, 0])).toEqual(leaf('b'));
      expect(getNodeAtPath(tree, [1, 1])).toEqual(leaf('c'));
    });

    it('returns null when the path runs off the tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(getNodeAtPath(tree, [0, 0])).toBeNull();
    });
  });

  describe('findRightDividerPath', () => {
    it('returns null for a single leaf (no divider)', () => {
      expect(findRightDividerPath(leaf('a'), 'a')).toBeNull();
    });

    it('returns the root for the left child of a v split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findRightDividerPath(tree, 'a')).toEqual([]);
    });

    it('returns null for the right child of a v split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findRightDividerPath(tree, 'b')).toBeNull();
    });

    it('returns null when the only ancestor splits are horizontal', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findRightDividerPath(tree, 'a')).toBeNull();
    });

    it('returns the deepest v split where the leaf is in the left child', () => {
      // Tree:
      //   root v
      //   /   \
      //  a     v
      //       / \
      //      h   c
      //     / \
      //    b   d
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: {
          kind: 'split',
          dir: 'v',
          ratio: 0.5,
          a: {
            kind: 'split',
            dir: 'h',
            ratio: 0.5,
            a: leaf('b'),
            b: leaf('d'),
          },
          b: leaf('c'),
        },
      };
      // a is in the left of the root v → right divider is the root v.
      expect(findRightDividerPath(tree, 'a')).toEqual([]);
      // b is in the left of [1,0] (h split, ignored), then left of [1] (v split) → [1].
      expect(findRightDividerPath(tree, 'b')).toEqual([1]);
      // d is in the right of [1,0] (h split) — leaf is in b child, not a → no match there.
      // d is then in the left of [1] (v split) → [1].
      expect(findRightDividerPath(tree, 'd')).toEqual([1]);
      // c is in the right of [1] (v split) → no match. No other v ancestors → null.
      expect(findRightDividerPath(tree, 'c')).toBeNull();
    });

    it('returns null when the leaf is not in the tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findRightDividerPath(tree, 'z')).toBeNull();
    });
  });

  describe('findBottomDividerPath', () => {
    it('returns null for a single leaf (no divider)', () => {
      expect(findBottomDividerPath(leaf('a'), 'a')).toBeNull();
    });

    it('returns the root for the top child of an h split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findBottomDividerPath(tree, 'a')).toEqual([]);
    });

    it('returns null for the bottom child of an h split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findBottomDividerPath(tree, 'b')).toBeNull();
    });

    it('returns null when the only ancestors are vertical splits', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findBottomDividerPath(tree, 'a')).toBeNull();
    });

    it('returns the deepest h split where the leaf is in the top child', () => {
      // Tree:
      //   root h
      //   /   \
      //  v     e
      // / \
      // a  h
      //   / \
      //  b   d
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: {
          kind: 'split',
          dir: 'v',
          ratio: 0.5,
          a: leaf('a'),
          b: {
            kind: 'split',
            dir: 'h',
            ratio: 0.5,
            a: leaf('b'),
            b: leaf('d'),
          },
        },
        b: leaf('e'),
      };
      // a is in the left of root h → not in b child, but in a (top) child → MATCH.
      // Wait — root is h, and a is in a child of root. So leafPath = [0, 0], and at i=1,
      // ancestor is the v split, not h, so no match. At i=0, ancestor is root h, leafPath[0]=0
      // (top child), dir is h → MATCH. Returns [].
      expect(findBottomDividerPath(tree, 'a')).toEqual([]);
      // b is in [0, 1, 0] — top of [0,1] (h split) → [0, 1].
      expect(findBottomDividerPath(tree, 'b')).toEqual([0, 1]);
      // d is in [0, 1, 1] — bottom of [0,1] (h split) → no match there. Then [0] (v split), not h. Then [] (h split), but leafPath[0]=0 (top) — wait, d is at [0, 1, 1], so leafPath[0] = 0, ancestor at [] is root h, leafPath[0]=0, dir h → MATCH? But d is the bottom-right of the left half, it has no bottom divider that would resize it.
      // Hmm — at i=2, ancestor is h split at [0, 1], leafPath[2]=1 (bottom), no match.
      // At i=1, ancestor is v split at [0], not h. No match.
      // At i=0, ancestor is root h, leafPath[0]=0 (top), dir h → MATCH. Returns [].
      // But this is wrong — d is at the bottom of the right column of the left half, so its bottom
      // edge is the bottom of the left half, which is the root h divider. Wait, actually d IS the
      // bottom — the root h is the divider between the top half (v split) and bottom half (e).
      // So d's bottom is at the root h divider. Dragging root h down would make d taller. Correct.
      expect(findBottomDividerPath(tree, 'd')).toEqual([]);
      // e is at [1] — bottom of root h → no match.
      expect(findBottomDividerPath(tree, 'e')).toBeNull();
    });

    it('returns null when the leaf is not in the tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findBottomDividerPath(tree, 'z')).toBeNull();
    });
  });

  describe('findLeftDividerPath', () => {
    it('returns null for a single leaf (no divider)', () => {
      expect(findLeftDividerPath(leaf('a'), 'a')).toBeNull();
    });

    it('returns the root for the right child of a v split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findLeftDividerPath(tree, 'b')).toEqual([]);
    });

    it('returns null for the left child of a v split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findLeftDividerPath(tree, 'a')).toBeNull();
    });

    it('returns the deepest v split where the leaf is in the right child', () => {
      // Tree:
      //   root v
      //   /   \
      //  v     c
      //  / \
      // a   v
      //    / \
      //   b   d
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: {
          kind: 'split',
          dir: 'v',
          ratio: 0.5,
          a: leaf('a'),
          b: {
            kind: 'split',
            dir: 'v',
            ratio: 0.5,
            a: leaf('b'),
            b: leaf('d'),
          },
        },
        b: leaf('c'),
      };
      // c is in the right of the root v → left divider is the root v.
      expect(findLeftDividerPath(tree, 'c')).toEqual([]);
      // d is in the right of [0,1] (v split) → [0, 1].
      expect(findLeftDividerPath(tree, 'd')).toEqual([0, 1]);
      // b is in the left of [0,1] (v split) → no match there. b is in
      // the right of [0] (v split) → [0]. That divider is the left
      // edge of the [0,1] subtree, i.e., the left edge of the {b, d}
      // pair — the leftmost divider that controls b's width.
      expect(findLeftDividerPath(tree, 'b')).toEqual([0]);
      // a is in the left of [0] (v split) → no match.
      expect(findLeftDividerPath(tree, 'a')).toBeNull();
    });

    it('returns null when the leaf is not in the tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'v',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findLeftDividerPath(tree, 'z')).toBeNull();
    });
  });

  describe('findTopDividerPath', () => {
    it('returns null for a single leaf (no divider)', () => {
      expect(findTopDividerPath(leaf('a'), 'a')).toBeNull();
    });

    it('returns the root for the bottom child of an h split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findTopDividerPath(tree, 'b')).toEqual([]);
    });

    it('returns null for the top child of an h split', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findTopDividerPath(tree, 'a')).toBeNull();
    });

    it('returns null when the leaf is not in the tree', () => {
      const tree: SplitTree = {
        kind: 'split',
        dir: 'h',
        ratio: 0.5,
        a: leaf('a'),
        b: leaf('b'),
      };
      expect(findTopDividerPath(tree, 'z')).toBeNull();
    });
  });
});
