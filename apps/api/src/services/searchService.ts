import { z } from 'zod';
import type {
  RepositoryRecord,
  SearchMetadata,
  SearchResponse,
  SearchResult,
  SearchStrategy,
  UpdateLmStudioSettingsInput,
} from '@github-stars-ai-search/shared';
import { analyzeQuery, type QueryAnalysisResult } from '../lib/queryAnalyzer.js';
import { reciprocalRankScore, sanitizeFtsQuery } from '../lib/search.js';
import { LMStudioClient } from '../lib/lmStudio.js';
import { CatalogService } from './catalogService.js';

const RERANK_TARGET_CANDIDATES = 24;
const RERANK_MAX_CANDIDATES = 30;

interface RepositoryScore {
  score: number;
  reasons: Set<string>;
  evidenceSnippets: string[];
  matchedDocumentKinds: Set<string>;
}

interface RankedRepositoryCandidate {
  repositoryId: number;
  repository: RepositoryRecord;
  match: RepositoryScore;
}

type SemanticEmbeddingMode = SearchMetadata['semanticEmbeddingMode'];

const rerankResponseSchema = z.object({
  rankedResults: z.array(z.object({
    id: z.number().int(),
    relevanceExplanation: z.string().trim().min(1).optional(),
  })),
});

function createScoreEntry(): RepositoryScore {
  return {
    score: 0,
    reasons: new Set<string>(),
    evidenceSnippets: [],
    matchedDocumentKinds: new Set<string>(),
  };
}

function getStrategy(type: QueryAnalysisResult['type']): SearchStrategy {
  switch (type) {
    case 'semantic':
      return 'semantic';
    case 'complex':
      return 'deep';
    default:
      return 'fast';
  }
}

function buildFallbackRelevanceExplanation(match: RepositoryScore): string | undefined {
  const primaryReason = Array.from(match.reasons)[0];
  if (!primaryReason) {
    return undefined;
  }

  const supportingKinds = Array.from(match.matchedDocumentKinds).slice(0, 2);
  if (supportingKinds.length === 0) {
    return primaryReason;
  }

  return `${primaryReason}; supporting documents: ${supportingKinds.join(', ')}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function averageEmbeddings(embeddings: ReadonlyArray<ArrayLike<number>>): number[] {
  if (embeddings.length === 0) {
    return [];
  }

  const dimension = embeddings[0]?.length ?? 0;
  if (dimension === 0 || embeddings.some((embedding) => embedding.length !== dimension)) {
    return [];
  }

  const averaged = new Array<number>(dimension).fill(0);
  for (const embedding of embeddings) {
    for (let index = 0; index < dimension; index += 1) {
      averaged[index] = (averaged[index] ?? 0) + Number(embedding[index] ?? 0);
    }
  }

  return averaged.map((value) => value / embeddings.length);
}

async function buildSemanticRetrievalEmbedding(
  client: LMStudioClient,
  query: string,
  analysis: QueryAnalysisResult,
  strategy: SearchStrategy,
): Promise<{ embedding: number[]; embeddingMode: SemanticEmbeddingMode; hypotheticalDocumentUsed: boolean }> {
  const [rawQueryEmbedding] = await client.embed([query]);
  const rawEmbedding = rawQueryEmbedding ?? [];

  if (strategy === 'fast' || !analysis.hypotheticalDocument) {
    return {
      embedding: rawEmbedding,
      embeddingMode: 'raw-query',
      hypotheticalDocumentUsed: false,
    };
  }

  try {
    const [hypotheticalEmbedding] = await client.embed([analysis.hypotheticalDocument]);
    const averagedEmbedding = averageEmbeddings([rawEmbedding, hypotheticalEmbedding ?? []]);
    if (averagedEmbedding.length > 0) {
      return {
        embedding: averagedEmbedding,
        embeddingMode: 'hyde-averaged',
        hypotheticalDocumentUsed: true,
      };
    }
  } catch {
    return {
      embedding: rawEmbedding,
      embeddingMode: 'raw-query',
      hypotheticalDocumentUsed: false,
    };
  }

  return {
    embedding: rawEmbedding,
    embeddingMode: 'raw-query',
    hypotheticalDocumentUsed: false,
  };
}

function buildCandidateSummary(candidate: RankedRepositoryCandidate): Record<string, unknown> {
  const { repository, match } = candidate;
  const evidence = match.evidenceSnippets
    .map((snippet) => truncateText(snippet, 180))
    .filter(Boolean)
    .slice(0, 3);

  return {
    id: repository.id,
    name: repository.fullName,
    ...(repository.description ? { description: truncateText(repository.description, 220) } : {}),
    ...(repository.summary ? { summary: truncateText(repository.summary, 240) } : {}),
    ...(repository.tags.length > 0 ? { tags: repository.tags.slice(0, 8) } : {}),
    ...(repository.platforms.length > 0 ? { platforms: repository.platforms } : {}),
    ...(repository.topics.length > 0 ? { topics: repository.topics.slice(0, 8) } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

function buildRerankPrompt(
  query: string,
  analysis: QueryAnalysisResult,
  candidates: RankedRepositoryCandidate[],
): string {
  return [
    'Rank repository candidates for a GitHub stars search.',
    `User query: ${query}`,
    `Search intent: ${analysis.intent}`,
    `Expanded query: ${analysis.expandedQuery}`,
    analysis.hypotheticalDocument ? `Semantic profile: ${truncateText(analysis.hypotheticalDocument, 260)}` : undefined,
    'Return strict JSON with key rankedResults.',
    'Each rankedResults item must include id and a short relevanceExplanation.',
    'Use only candidate ids from the list. Rank best first. Keep each explanation under 120 characters.',
    `Candidates: ${JSON.stringify(candidates.map(buildCandidateSummary))}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

export class SearchService {
  constructor(private readonly catalogService: CatalogService) {}

  private async rerankCandidates(
    query: string,
    analysis: QueryAnalysisResult,
    candidates: RankedRepositoryCandidate[],
    lmStudioConfig: UpdateLmStudioSettingsInput,
  ): Promise<Map<number, string | undefined>> {
    if (candidates.length < 2) {
      return new Map();
    }

    const client = new LMStudioClient(lmStudioConfig);
    const response = await client.chatJson(
      buildRerankPrompt(query, analysis, candidates),
      'You rerank repository search candidates and return valid JSON only.',
      700,
    );

    const parsed = rerankResponseSchema.parse(response);
    const candidateIds = new Set(candidates.map((candidate) => candidate.repositoryId));
    const explanations = new Map<number, string | undefined>();

    for (const result of parsed.rankedResults) {
      if (!candidateIds.has(result.id) || explanations.has(result.id)) {
        continue;
      }

      const normalizedExplanation = result.relevanceExplanation
        ? truncateText(result.relevanceExplanation, 120)
        : undefined;

      explanations.set(result.id, normalizedExplanation);
    }

    if (explanations.size === 0) {
      throw new Error('LM Studio returned no usable reranked ids.');
    }

    return explanations;
  }

  async search(query: string, limit: number, lmStudioConfig: UpdateLmStudioSettingsInput): Promise<SearchResponse> {
    const start = Date.now();
    const analysis = await analyzeQuery(query, lmStudioConfig);
    const requestedStrategy = getStrategy(analysis.type);
    const keywordSeed = analysis.type === 'simple' ? query : analysis.expandedQuery;
    const ftsQuery = sanitizeFtsQuery(keywordSeed);
    const strategy = !ftsQuery && requestedStrategy === 'fast' ? 'semantic' : requestedStrategy;
    const repositoryKeywordMatches = ftsQuery
      ? this.catalogService.keywordSearchRepositories(ftsQuery, limit * 5)
      : [];
    const chunkKeywordMatches = ftsQuery
      ? this.catalogService.keywordSearchChunks(ftsQuery, limit * 10)
      : [];

    const scoreMap = new Map<number, RepositoryScore>();

    for (const match of repositoryKeywordMatches) {
      const entry = scoreMap.get(match.repositoryId) ?? createScoreEntry();
      entry.score += reciprocalRankScore(match.rank) * 1.15;
      entry.reasons.add('repository metadata keyword match');
      scoreMap.set(match.repositoryId, entry);
    }

    for (const match of chunkKeywordMatches) {
      const entry = scoreMap.get(match.repositoryId) ?? createScoreEntry();
      entry.score += reciprocalRankScore(match.rank) * 0.95;
      entry.reasons.add('document keyword match');
      entry.matchedDocumentKinds.add(match.kind);
      if (entry.evidenceSnippets.length < 3) {
        entry.evidenceSnippets.push(match.snippet.replaceAll('[', '').replaceAll(']', ''));
      }
      scoreMap.set(match.repositoryId, entry);
    }

    const shouldRunVectorSearch = strategy !== 'fast' || scoreMap.size < Math.max(4, limit);
    let semanticEmbeddingMode: SemanticEmbeddingMode = 'raw-query';
    let hypotheticalDocumentUsed = false;
    if (shouldRunVectorSearch) {
      const client = new LMStudioClient(lmStudioConfig);
      const semanticRetrieval = await buildSemanticRetrievalEmbedding(client, query, analysis, strategy);
      semanticEmbeddingMode = semanticRetrieval.embeddingMode;
      hypotheticalDocumentUsed = semanticRetrieval.hypotheticalDocumentUsed;
      const vectorMatches = this.catalogService.rankChunkVectors(
        semanticRetrieval.embedding,
        strategy === 'fast' ? limit * 4 : limit * 12,
        strategy === 'fast' ? 0.18 : 0.12,
      );

      vectorMatches.forEach((match, index) => {
        const entry = scoreMap.get(match.repositoryId) ?? createScoreEntry();
        const semanticWeight = strategy === 'fast' ? 1.2 : strategy === 'semantic' ? 2.1 : 2.5;
        entry.score += match.score * semanticWeight + reciprocalRankScore(index) * 0.4;
        entry.reasons.add(hypotheticalDocumentUsed ? 'semantic HyDE vector similarity' : 'semantic vector similarity');
        entry.matchedDocumentKinds.add(match.kind);
        if (entry.evidenceSnippets.length < 3) {
          entry.evidenceSnippets.push(match.snippet);
        }
        scoreMap.set(match.repositoryId, entry);
      });
    }

    const totalCandidates = scoreMap.size;

    const rankedEntries = Array.from(scoreMap.entries())
      .sort((left, right) => right[1].score - left[1].score);

    const rerankCandidateLimit = Math.min(Math.max(limit, RERANK_TARGET_CANDIDATES), RERANK_MAX_CANDIDATES);
    const candidatePoolLimit = strategy === 'fast'
      ? limit
      : Math.max(limit, rerankCandidateLimit);
    const candidatePoolIds = rankedEntries
      .slice(0, candidatePoolLimit)
      .map(([repositoryId]) => repositoryId);
    const repositories = this.catalogService.getRepositoryByIds(candidatePoolIds);
    const candidatePool = rankedEntries
      .slice(0, candidatePoolLimit)
      .map(([repositoryId, match]) => {
        const repository = repositories.get(repositoryId);
        if (!repository) {
          return null;
        }

        return {
          repositoryId,
          repository,
          match,
        };
      })
      .filter((value): value is RankedRepositoryCandidate => value !== null);
    const candidateById = new Map(candidatePool.map((candidate) => [candidate.repositoryId, candidate]));

    let orderedCandidates = candidatePool;
    const rerankExplanations = new Map<number, string | undefined>();

    if (strategy !== 'fast') {
      const rerankCandidates = candidatePool.slice(0, rerankCandidateLimit);
      try {
        const reranked = await this.rerankCandidates(query, analysis, rerankCandidates, lmStudioConfig);
        reranked.forEach((explanation, repositoryId) => {
          rerankExplanations.set(repositoryId, explanation);
        });

        const rerankedIds = Array.from(reranked.keys());
        const remainingIds = candidatePool
          .map((candidate) => candidate.repositoryId)
          .filter((repositoryId) => !reranked.has(repositoryId));
        const orderedIds = [...rerankedIds, ...remainingIds];

        orderedCandidates = orderedIds
          .map((repositoryId) => candidateById.get(repositoryId) ?? null)
          .filter((value): value is RankedRepositoryCandidate => value !== null);
      } catch {
        orderedCandidates = candidatePool;
      }
    }

    const results: SearchResult[] = orderedCandidates
      .slice(0, limit)
      .map(({ repositoryId, repository, match }) => {
        const rerankedExplanation = rerankExplanations.get(repositoryId);
        const relevanceExplanation = rerankedExplanation ?? buildFallbackRelevanceExplanation(match);

        return {
          repository,
          score: Number(match.score.toFixed(4)),
          reasons: Array.from(match.reasons),
          evidenceSnippets: match.evidenceSnippets.slice(0, 3),
          matchedDocumentKinds: Array.from(match.matchedDocumentKinds),
          ...(relevanceExplanation ? { relevanceExplanation } : {}),
        };
      });

    const timingMs = Date.now() - start;
    const metadata: SearchMetadata = {
      strategy,
      timingMs,
      totalCandidates,
      analysisType: analysis.type,
      expandedQuery: analysis.expandedQuery,
      intent: analysis.intent,
      keywords: analysis.keywords,
      ...(analysis.hypotheticalDocument ? { hypotheticalDocument: analysis.hypotheticalDocument } : {}),
      hypotheticalDocumentUsed,
      semanticEmbeddingMode,
    };

    return {
      query,
      strategy,
      timingMs,
      totalCandidates,
      metadata,
      results,
    };
  }
}
