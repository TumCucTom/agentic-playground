import { describe, it, expect } from 'vitest';
import { createPanelOfType } from '../../src/renderer/panels/factory';
import { ContentRef } from '../../src/shared/types';

function webviewRef(p: ReturnType<typeof createPanelOfType>): { url: string } {
  if (p.content.type !== 'webview') throw new Error('expected webview panel');
  return p.content.ref;
}

function embeddedRef(p: ReturnType<typeof createPanelOfType>): { appBundleId: string } {
  if (p.content.type !== 'embedded') throw new Error('expected embedded panel');
  return p.content.ref;
}

describe('createPanelOfType', () => {
  describe('webview factory', () => {
    it('defaults the URL to https://example.com when no opts are passed', () => {
      const p = createPanelOfType('webview', 100, 100);
      expect(webviewRef(p).url).toBe('https://example.com');
    });

    it('uses opts.url when provided', () => {
      const p = createPanelOfType('webview', 100, 100, { url: 'https://notion.so' });
      expect(webviewRef(p).url).toBe('https://notion.so');
    });

    it('sets the panel title to the URL (so the tab strip shows where it points)', () => {
      const p = createPanelOfType('webview', 100, 100, { url: 'https://notion.so' });
      expect(p.title).toBe('https://notion.so');
    });
  });

  describe('embedded factory', () => {
    it('creates an empty App Launcher panel with no bundle id', () => {
      const p = createPanelOfType('embedded', 100, 100);
      expect(embeddedRef(p).appBundleId).toBe('');
    });

    it('ignores opts.url (embedded is for native apps, not web)', () => {
      const p = createPanelOfType('embedded', 100, 100, { url: 'https://notion.so' });
      expect(embeddedRef(p).appBundleId).toBe('');
    });
  });

  describe('panel metadata', () => {
    it('generates a unique id per call', () => {
      const a = createPanelOfType('webview', 0, 0);
      const b = createPanelOfType('webview', 0, 0);
      expect(a.id).not.toBe(b.id);
      expect(typeof a.id).toBe('string');
      expect(a.id.length).toBeGreaterThan(0);
    });

    it('centers the panel on (x, y) using the default 500x360 size', () => {
      const p = createPanelOfType('terminal', 200, 200);
      // Position = (x - w/2, y - h/2) = (200 - 250, 200 - 180) = (-50, 20)
      expect(p.position).toEqual({ x: -50, y: 20 });
      expect(p.size).toEqual({ width: 500, height: 360 });
    });

    it('starts every panel as idle and at zOrder 0', () => {
      const p = createPanelOfType('editor', 0, 0);
      expect(p.state).toBe('idle');
      expect(p.zOrder).toBe(0);
    });
  });

  describe('other panel types', () => {
    it('creates a terminal with zsh cwd~ at 80x24', () => {
      const p = createPanelOfType('terminal', 0, 0);
      if (p.content.type !== 'terminal') throw new Error('expected terminal');
      expect(p.content.ref.shell).toBe('/bin/zsh');
      expect(p.content.ref.cwd).toBe('~');
      expect(p.content.ref.cols).toBe(80);
      expect(p.content.ref.rows).toBe(24);
    });

    it('creates an editor with no file open', () => {
      const p = createPanelOfType('editor', 0, 0);
      if (p.content.type !== 'editor') throw new Error('expected editor');
      expect(p.content.ref.filePath).toBeNull();
    });

    it('throws on unknown panel type', () => {
      expect(() =>
        createPanelOfType('bogus' as never, 0, 0)
      ).toThrow(/unknown panel type/i);
    });
  });
});
