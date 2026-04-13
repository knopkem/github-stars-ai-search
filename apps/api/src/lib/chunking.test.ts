import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunking.js';

describe('chunkDocument', () => {
  it('keeps short documents in one chunk', () => {
    const chunks = chunkDocument({
      kind: 'readme',
      path: 'README.md',
      title: 'README',
      content: 'Short README content',
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Short README content');
  });

  it('splits long documents into multiple chunks', () => {
    const chunks = chunkDocument({
      kind: 'readme',
      path: 'README.md',
      title: 'README',
      content: '# Heading\n\n' + 'x'.repeat(2600),
    });

    expect(chunks.length).toBeGreaterThan(1);
  });
});
