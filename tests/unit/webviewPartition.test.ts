import { describe, it, expect } from 'vitest';
import { partitionForPanel } from '../../src/renderer/panels/Webview';

describe('partitionForPanel', () => {
  it('returns a persist:webview-<id> partition for a given panel id', () => {
    expect(partitionForPanel('p_abc')).toBe('persist:webview-p_abc');
  });

  it('is idempotent — same id always returns the same partition', () => {
    const a = partitionForPanel('p_xyz');
    const b = partitionForPanel('p_xyz');
    expect(a).toBe(b);
  });

  it('returns a distinct partition for each id', () => {
    const partitions = new Set([
      partitionForPanel('p_one'),
      partitionForPanel('p_two'),
      partitionForPanel('p_three'),
    ]);
    expect(partitions.size).toBe(3);
  });

  it('always begins with the "persist:" Electron session prefix', () => {
    // Electron session partitions need this prefix for cookies/storage
    // to survive across restarts. If we ever change the prefix the
    // existing user sessions will be lost — so guard the shape.
    expect(partitionForPanel('any-id')).toMatch(/^persist:/);
  });
});
