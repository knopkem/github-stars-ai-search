import { z } from 'zod';

export const repositoryPlatformSchema = z.enum([
  'web',
  'windows',
  'macos',
  'linux',
  'ios',
  'android',
  'cli',
  'docker',
]);

export const repositorySchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  name: z.string(),
  ownerLogin: z.string(),
  ownerAvatarUrl: z.string().nullable().optional(),
  description: z.string().nullable(),
  htmlUrl: z.string().url(),
  stargazerCount: z.number().int().nonnegative(),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  defaultBranch: z.string().nullable(),
  pushedAt: z.string().nullable(),
  starredAt: z.string().nullable(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  platforms: z.array(repositoryPlatformSchema),
  watchReleases: z.boolean(),
  indexedAt: z.string().nullable(),
});

export const releaseAssetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  downloadCount: z.number().int().nonnegative(),
  contentType: z.string().nullable(),
  browserDownloadUrl: z.string().url(),
});

export const releaseSchema = z.object({
  id: z.number().int(),
  repositoryId: z.number().int(),
  repositoryFullName: z.string(),
  tagName: z.string(),
  name: z.string(),
  body: z.string(),
  publishedAt: z.string().nullable(),
  htmlUrl: z.string().url(),
  isPrerelease: z.boolean(),
  isDraft: z.boolean(),
  assets: z.array(releaseAssetSchema),
});

export const assetFilterSchema = z.object({
  id: z.number().int(),
  keyword: z.string().min(1),
});

export const appSettingsSchema = z.object({
  githubConfigured: z.boolean(),
  lmStudio: z
    .object({
      baseUrl: z.string().url(),
      chatModel: z.string(),
      embeddingModel: z.string(),
      apiKeyConfigured: z.boolean(),
      concurrency: z.number().int().min(1).max(8),
    })
    .nullable(),
});

export const updateGitHubSettingsSchema = z.object({
  token: z.string().trim().min(20).max(255),
});

export const updateLmStudioSettingsSchema = z.object({
  baseUrl: z.string().trim().url(),
  chatModel: z.string().trim().min(1),
  embeddingModel: z.string().trim().min(1),
  apiKey: z.string().trim().optional().default(''),
  concurrency: z.number().int().min(1).max(8).optional().default(1),
});

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(10_000).optional().default(1_000),
});

export const searchResultSchema = z.object({
  repository: repositorySchema,
  score: z.number(),
  reasons: z.array(z.string()),
  evidenceSnippets: z.array(z.string()),
  matchedDocumentKinds: z.array(z.string()),
  relevanceExplanation: z.string().trim().min(1).optional(),
});

export const searchStrategySchema = z.enum(['fast', 'semantic', 'deep']);
export const queryAnalysisTypeSchema = z.enum(['simple', 'semantic', 'complex']);
export const searchMetadataSchema = z.object({
  strategy: searchStrategySchema,
  timingMs: z.number().nonnegative(),
  totalCandidates: z.number().int().nonnegative(),
  analysisType: queryAnalysisTypeSchema,
  expandedQuery: z.string(),
  intent: z.string(),
  keywords: z.array(z.string()),
  hypotheticalDocument: z.string().trim().min(1).optional(),
  hypotheticalDocumentUsed: z.boolean(),
  semanticEmbeddingMode: z.enum(['raw-query', 'hyde-averaged']),
});

export const searchResponseSchema = z.object({
  query: z.string(),
  strategy: searchStrategySchema,
  timingMs: z.number().nonnegative(),
  totalCandidates: z.number().int().nonnegative(),
  metadata: searchMetadataSchema,
  results: z.array(searchResultSchema),
});

export const syncSummarySchema = z.object({
  repositoryCount: z.number().int().nonnegative(),
  indexedRepositoryCount: z.number().int().nonnegative(),
  releaseCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const syncProgressPhaseSchema = z.enum(['discovering', 'fetching', 'indexing', 'analyzing']);

export const syncProgressSchema = z.object({
  type: z.literal('progress'),
  current: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  repository: z.string(),
  phase: syncProgressPhaseSchema,
});

export const syncProgressEventSchema = z.discriminatedUnion('type', [
  syncProgressSchema,
  z.object({
    type: z.literal('complete'),
    summary: syncSummarySchema,
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('cancelled'),
    summary: syncSummarySchema,
  }),
]);

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  databasePath: z.string(),
});

export const importDocumentSchema = z.object({
  id: z.number().int(),
  repositoryId: z.number().int(),
  kind: z.string(),
  path: z.string().nullable(),
  title: z.string(),
  content: z.string(),
});

export const importChunkSchema = z.object({
  id: z.number().int(),
  repositoryId: z.number().int(),
  documentId: z.number().int(),
  kind: z.string(),
  path: z.string().nullable(),
  chunkIndex: z.number().int(),
  content: z.string(),
  embedding: z.array(z.number()),
});

export const exportPayloadSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  repositories: z.array(repositorySchema),
  releases: z.array(releaseSchema),
  assetFilters: z.array(assetFilterSchema),
  documents: z.array(importDocumentSchema),
  chunks: z.array(importChunkSchema),
  lmStudio: z
    .object({
      baseUrl: z.string().url(),
      chatModel: z.string(),
      embeddingModel: z.string(),
      concurrency: z.number().int().min(1).max(8).optional().default(1),
    })
    .nullable(),
});

export const lmStudioModelsResponseSchema = z.object({
  chatModels: z.array(z.string()),
  embeddingModels: z.array(z.string()),
});

export const lmStudioTestResultSchema = z.object({
  chat: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
  }),
  embedding: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
  }),
});

export const hardwareInfoSchema = z.object({
  gpu: z.object({
    name: z.string(),
    vramMb: z.number(),
  }).nullable(),
  ramMb: z.number(),
  cpuCores: z.number(),
});

export type RepositoryRecord = z.infer<typeof repositorySchema>;
export type ReleaseRecord = z.infer<typeof releaseSchema>;
export type ReleaseAssetRecord = z.infer<typeof releaseAssetSchema>;
export type AssetFilterRecord = z.infer<typeof assetFilterSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type UpdateGitHubSettingsInput = z.infer<typeof updateGitHubSettingsSchema>;
export type UpdateLmStudioSettingsInput = z.infer<typeof updateLmStudioSettingsSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchStrategy = z.infer<typeof searchStrategySchema>;
export type QueryAnalysisType = z.infer<typeof queryAnalysisTypeSchema>;
export type SearchMetadata = z.infer<typeof searchMetadataSchema>;
export type SyncSummary = z.infer<typeof syncSummarySchema>;
export type SyncProgressPhase = z.infer<typeof syncProgressPhaseSchema>;
export type SyncProgress = z.infer<typeof syncProgressSchema>;
export type SyncProgressEvent = z.infer<typeof syncProgressEventSchema>;
export type ExportPayload = z.infer<typeof exportPayloadSchema>;
export type LmStudioModelsResponse = z.infer<typeof lmStudioModelsResponseSchema>;
export type LmStudioTestResult = z.infer<typeof lmStudioTestResultSchema>;
export type HardwareInfo = z.infer<typeof hardwareInfoSchema>;
