import { describe, expect, it, vi } from 'vitest';
import { analyzeQuery, generateHypotheticalDocument } from './queryAnalyzer.js';

const lmStudioConfig = {
  baseUrl: 'http://127.0.0.1:1234',
  chatModel: 'test-chat',
  embeddingModel: 'test-embed',
  apiKey: '',
  concurrency: 1,
} as const;

describe('queryAnalyzer', () => {
  it('keeps simple keyword queries on the lightweight path', async () => {
    const analysis = await analyzeQuery('audio production', lmStudioConfig);

    expect(analysis.type).toBe('simple');
    expect(analysis.expandedQuery).toBe('audio production');
    expect(analysis.keywords).toContain('audio');
  });

  it('falls back safely when the analyzer request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'error',
      text: async () => 'boom',
    }));

    const analysis = await analyzeQuery('what are the best self-hosted git for teams?', lmStudioConfig);

    expect(analysis.type).toBe('semantic');
    expect(analysis.intent).toContain('Find repositories');

    vi.unstubAllGlobals();
  });

  it('generates a hypothetical document from LM Studio chat output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'A repository that ships a polished self-hosted Git service with LDAP support.',
            },
          },
        ],
      }),
    }));

    const document = await generateHypotheticalDocument(
      'self-hosted git with ldap',
      'Find repositories for self-hosted git platforms',
      lmStudioConfig,
    );

    expect(document).toContain('self-hosted Git service');

    vi.unstubAllGlobals();
  });
});
