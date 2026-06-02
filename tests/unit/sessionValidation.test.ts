import { describe, it, expect } from 'vitest';
import { validateSessionName, SESSION_NAME_MAX_LENGTH } from '../../src/shared/sessionValidation';

describe('validateSessionName', () => {
  it('returns the trimmed name on valid input', () => {
    expect(validateSessionName('My Project')).toBe('My Project');
  });

  it('accepts underscores, hyphens, and spaces', () => {
    expect(validateSessionName('work_in-progress 2')).toBe('work_in-progress 2');
  });

  it('trims surrounding whitespace before accepting', () => {
    expect(validateSessionName('  hello  ')).toBe('hello');
  });

  it('throws on an empty string', () => {
    expect(() => validateSessionName('')).toThrow();
  });

  it('throws on whitespace-only input', () => {
    expect(() => validateSessionName('   ')).toThrow();
  });

  it('throws on names longer than the max length', () => {
    expect(() => validateSessionName('a'.repeat(SESSION_NAME_MAX_LENGTH + 1))).toThrow();
  });

  it('accepts a name at exactly the max length', () => {
    expect(validateSessionName('a'.repeat(SESSION_NAME_MAX_LENGTH))).toBe('a'.repeat(SESSION_NAME_MAX_LENGTH));
  });

  it('throws on names with slashes (path traversal bait)', () => {
    expect(() => validateSessionName('foo/bar')).toThrow();
    expect(() => validateSessionName('..\\foo')).toThrow();
  });

  it('throws on names starting with a dot (control-file bait)', () => {
    expect(() => validateSessionName('.active')).toThrow();
    expect(() => validateSessionName('.hidden')).toThrow();
  });

  it('throws on names with control characters or punctuation', () => {
    for (const bad of ['foo!', 'foo@bar', 'foo,bar', 'foo?bar', 'foo*bar']) {
      expect(() => validateSessionName(bad)).toThrow();
    }
  });
});
