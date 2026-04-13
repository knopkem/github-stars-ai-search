import { describe, expect, it } from 'vitest';
import { cosineSimilarity, sanitizeFtsQuery } from './search.js';

describe('search helpers', () => {
  it('computes cosine similarity for matching vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('sanitizes fts queries', () => {
    expect(sanitizeFtsQuery('audio production!')).toBe('"audio" AND "production"');
    expect(sanitizeFtsQuery('"audio production" OR synth-pop')).toBe('"audio production" OR "synth-pop"');
    expect(sanitizeFtsQuery('audio or production')).toBe('"audio" OR "production"');
  });
});
