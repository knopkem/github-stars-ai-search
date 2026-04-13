import {
  type LmStudioModelsResponse,
  type LmStudioTestResult,
  type UpdateLmStudioSettingsInput,
} from '@github-stars-ai-search/shared';
import {
  RetryableHttpError,
  isRetryableHttpStatus,
  withDelayedRetry,
} from './retry.js';

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface EmbeddingResponse {
  data?: Array<{
    embedding?: number[];
  }>;
}

interface ModelsResponse {
  data?: Array<{
    id: string;
    type?: string;
    object?: string;
  }>;
}

function ensureLoopbackUrl(baseUrl: string): URL {
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost'
    || hostname === '::1'
    || hostname.startsWith('127.');

  if (!isLoopback) {
    throw new Error('LM Studio must point to a loopback URL such as http://127.0.0.1:1234.');
  }

  return parsed;
}

function buildApiUrl(baseUrl: string, endpoint: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    const base = new URL(normalizedBaseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    if (basePath.endsWith('/v1') && endpoint.startsWith('v1/')) {
      return new URL(endpoint.slice(3), normalizedBaseUrl).toString();
    }
    return new URL(endpoint, normalizedBaseUrl).toString();
  } catch {
    return `${normalizedBaseUrl}${endpoint}`;
  }
}

function extractJsonBlock(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('LM Studio did not return JSON.');
  }
  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
}

export class LMStudioClient {
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly embeddingModel: string;
  private readonly apiKey: string;

  constructor(config: UpdateLmStudioSettingsInput) {
    const normalized = ensureLoopbackUrl(config.baseUrl);
    this.baseUrl = normalized.toString().replace(/\/$/, '');
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;
    this.apiKey = config.apiKey ?? '';
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async testConnection(): Promise<void> {
    await this.chat('Reply with exactly OK.', 'You are a connection test assistant.', 12);
  }

  async testChat(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now();
    try {
      await this.chat('Reply with exactly OK.', 'You are a connection test assistant.', 12);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: (error as Error).message, latencyMs: Date.now() - start };
    }
  }

  async testEmbedding(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now();
    try {
      const result = await this.embed(['connection test']);
      if (!result.length || !result[0]?.length) {
        return { ok: false, error: 'Embedding returned empty result.', latencyMs: Date.now() - start };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: (error as Error).message, latencyMs: Date.now() - start };
    }
  }

  async testBoth(): Promise<LmStudioTestResult> {
    const [chat, embedding] = await Promise.all([
      this.testChat(),
      this.testEmbedding(),
    ]);
    return { chat, embedding };
  }

  static async listModels(baseUrl: string, apiKey?: string): Promise<LmStudioModelsResponse> {
    const parsed = ensureLoopbackUrl(baseUrl);
    const normalizedUrl = parsed.toString().replace(/\/$/, '');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    const response = await withDelayedRetry(async () => {
      const currentResponse = await fetch(buildApiUrl(normalizedUrl, 'v1/models'), {
        method: 'GET',
        headers,
      });

      if (!currentResponse.ok) {
        const message = await currentResponse.text();
        const errorMessage = `LM Studio models error (${currentResponse.status}): ${message || currentResponse.statusText}`;
        if (isRetryableHttpStatus(currentResponse.status)) {
          throw new RetryableHttpError(errorMessage, currentResponse.status);
        }
        throw new Error(errorMessage);
      }

      return currentResponse;
    });

    const payload = (await response.json()) as ModelsResponse;
    const models = payload.data ?? [];

    const chatModels: string[] = [];
    const embeddingModels: string[] = [];

    for (const model of models) {
      const modelType = model.type?.toLowerCase();
      const modelId = model.id.toLowerCase();

      if (modelType === 'embedding' || modelId.includes('embed')) {
        embeddingModels.push(model.id);
      } else if (modelType === 'llm' || modelType === 'chat' || !modelType) {
        chatModels.push(model.id);
      } else {
        chatModels.push(model.id);
      }
    }

    return { chatModels, embeddingModels };
  }

  async chat(userPrompt: string, systemPrompt: string, maxTokens = 256): Promise<string> {
    const response = await withDelayedRetry(async () => {
      const currentResponse = await fetch(buildApiUrl(this.baseUrl, 'v1/chat/completions'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.chatModel,
          temperature: 0.1,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!currentResponse.ok) {
        const message = await currentResponse.text();
        const errorMessage = `LM Studio chat error (${currentResponse.status}): ${message || currentResponse.statusText}`;
        if (isRetryableHttpStatus(currentResponse.status)) {
          throw new RetryableHttpError(errorMessage, currentResponse.status);
        }
        throw new Error(errorMessage);
      }

      return currentResponse;
    });

    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('LM Studio returned an empty chat response.');
    }
    return content;
  }

  async chatJson(userPrompt: string, systemPrompt: string, maxTokens = 384): Promise<Record<string, unknown>> {
    const content = await this.chat(userPrompt, systemPrompt, maxTokens);
    return extractJsonBlock(content);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await withDelayedRetry(async () => {
      const currentResponse = await fetch(buildApiUrl(this.baseUrl, 'v1/embeddings'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.embeddingModel,
          input: texts,
        }),
      });

      if (!currentResponse.ok) {
        const message = await currentResponse.text();
        const errorMessage = `LM Studio embeddings error (${currentResponse.status}): ${message || currentResponse.statusText}`;
        if (isRetryableHttpStatus(currentResponse.status)) {
          throw new RetryableHttpError(errorMessage, currentResponse.status);
        }
        throw new Error(errorMessage);
      }

      return currentResponse;
    });

    const payload = (await response.json()) as EmbeddingResponse;
    return (payload.data ?? []).map((item) => item.embedding ?? []);
  }
}
