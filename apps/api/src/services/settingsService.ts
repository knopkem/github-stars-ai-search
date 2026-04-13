import type { DatabaseSync } from 'node:sqlite';
import {
  appSettingsSchema,
  updateLmStudioSettingsSchema,
  type AppSettings,
  type UpdateLmStudioSettingsInput,
} from '@github-stars-ai-search/shared';
import { EncryptionService } from '../lib/crypto.js';

const GITHUB_TOKEN_KEY = 'github_token_encrypted';
const LM_STUDIO_BASE_URL_KEY = 'lmstudio_base_url';
const LM_STUDIO_CHAT_MODEL_KEY = 'lmstudio_chat_model';
const LM_STUDIO_EMBEDDING_MODEL_KEY = 'lmstudio_embedding_model';
const LM_STUDIO_API_KEY = 'lmstudio_api_key_encrypted';
const LM_STUDIO_CONCURRENCY_KEY = 'lmstudio_concurrency';

export class SettingsService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly encryptionService: EncryptionService,
  ) {}

  private getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  saveGitHubToken(token: string): void {
    this.setSetting(GITHUB_TOKEN_KEY, this.encryptionService.encrypt(token));
  }

  getGitHubToken(): string {
    const encryptedToken = this.getSetting(GITHUB_TOKEN_KEY);
    if (!encryptedToken) {
      throw new Error('Configure a GitHub token before syncing the catalog.');
    }
    return this.encryptionService.decrypt(encryptedToken);
  }

  saveLmStudioConfig(input: UpdateLmStudioSettingsInput): void {
    const parsed = updateLmStudioSettingsSchema.parse(input);
    this.setSetting(LM_STUDIO_BASE_URL_KEY, parsed.baseUrl.replace(/\/$/, ''));
    this.setSetting(LM_STUDIO_CHAT_MODEL_KEY, parsed.chatModel);
    this.setSetting(LM_STUDIO_EMBEDDING_MODEL_KEY, parsed.embeddingModel);
    this.setSetting(LM_STUDIO_API_KEY, parsed.apiKey ? this.encryptionService.encrypt(parsed.apiKey) : '');
    this.setSetting(LM_STUDIO_CONCURRENCY_KEY, String(parsed.concurrency ?? 1));
  }

  getLmStudioConfig(): UpdateLmStudioSettingsInput {
    const baseUrl = this.getSetting(LM_STUDIO_BASE_URL_KEY);
    const chatModel = this.getSetting(LM_STUDIO_CHAT_MODEL_KEY);
    const embeddingModel = this.getSetting(LM_STUDIO_EMBEDDING_MODEL_KEY);

    if (!baseUrl || !chatModel || !embeddingModel) {
      throw new Error('Configure LM Studio before indexing or searching.');
    }

    const encryptedApiKey = this.getSetting(LM_STUDIO_API_KEY);
    const apiKey = encryptedApiKey ? this.encryptionService.decrypt(encryptedApiKey) : '';

    return updateLmStudioSettingsSchema.parse({
      baseUrl,
      chatModel,
      embeddingModel,
      apiKey,
      concurrency: Number.parseInt(this.getSetting(LM_STUDIO_CONCURRENCY_KEY) ?? '1', 10) || 1,
    });
  }

  getPublicSettings(): AppSettings {
    const lmBaseUrl = this.getSetting(LM_STUDIO_BASE_URL_KEY);
    const lmChatModel = this.getSetting(LM_STUDIO_CHAT_MODEL_KEY);
    const lmEmbeddingModel = this.getSetting(LM_STUDIO_EMBEDDING_MODEL_KEY);
    const lmApiKeyConfigured = !!this.getSetting(LM_STUDIO_API_KEY);
    const lmConcurrency = Number.parseInt(this.getSetting(LM_STUDIO_CONCURRENCY_KEY) ?? '1', 10) || 1;

    return appSettingsSchema.parse({
      githubConfigured: !!this.getSetting(GITHUB_TOKEN_KEY),
      lmStudio: lmBaseUrl && lmChatModel && lmEmbeddingModel
        ? {
            baseUrl: lmBaseUrl,
            chatModel: lmChatModel,
            embeddingModel: lmEmbeddingModel,
            apiKeyConfigured: lmApiKeyConfigured,
            concurrency: lmConcurrency,
          }
        : null,
    });
  }
}
