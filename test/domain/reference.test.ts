import { describe, expect, it } from 'vitest';
import { REFERENCE_PATTERN, makeReference } from '../../src/domain/reference.js';

describe('makeReference', () => {
  it('matches HT- plus 6 Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(makeReference((n) => crypto.getRandomValues(new Uint8Array(n)))).toMatch(REFERENCE_PATTERN);
    }
  });

  it('is deterministic for a given RNG and never emits I, L, O or U', () => {
    expect(makeReference(() => Uint8Array.from([0, 1, 10, 18, 31, 255]))).toBe('HT-01AJZZ');
    const all = Array.from({ length: 256 }, (_, i) => i);
    const chars = makeReference(() => Uint8Array.from(all.slice(0, 6)));
    expect(chars).toMatch(REFERENCE_PATTERN);
    const seen = new Set(all.map((b) => makeReference(() => Uint8Array.from([b, b, b, b, b, b])).slice(3, 4)));
    expect(seen.size).toBe(32);
    for (const c of 'ILOU') expect(seen.has(c)).toBe(false);
  });

  it('rejects look-alike characters in the pattern', () => {
    expect('HT-ABCDEI').not.toMatch(REFERENCE_PATTERN);
    expect('HT-ABCDE').not.toMatch(REFERENCE_PATTERN);
  });
});
