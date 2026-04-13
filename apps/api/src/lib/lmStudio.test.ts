import { afterEach, describe, expect, it, vi } from 'vitest';
import { LMStudioClient } from './lmStudio.js';

const config = {
  baseUrl: 'http://127.0.0.1:1234',
  chatModel: 'test-chat',
  embeddingModel: 'test-embed',
  apiKey: '',
  concurrency: 1,
} as const;

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('LMStudioClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries transient network failures before returning embeddings', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(createJsonResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new LMStudioClient(config);
    const embeddingsPromise = client.embed(['hello']);

    await vi.runAllTimersAsync();
    const embeddings = await embeddingsPromise;

    expect(embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries retryable HTTP failures before returning chat output', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary unavailable', { status: 503 }))
      .mockResolvedValueOnce(createJsonResponse({
        choices: [{ message: { content: 'OK' } }],
      }));

    vi.stubGlobal('fetch', fetchMock);

    const client = new LMStudioClient(config);
    const chatPromise = client.chat('Reply with OK.', 'You are a test assistant.', 12);

    await vi.runAllTimersAsync();
    const response = await chatPromise;

    expect(response).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
