import type { SearchResponse, SearchResult } from '@github-stars-ai-search/shared';
import { type UpdateLmStudioSettingsInput } from '@github-stars-ai-search/shared';
import { cosineSimilarity, reciprocalRankScore, sanitizeFtsQuery } from '../lib/search.js';
import { LMStudioClient } from '../lib/lmStudio.js';
import { CatalogService } from './catalogService.js';

export class SearchService {
  constructor(private readonly catalogService: CatalogService) {}

  async search(query: string, limit: number, lmStudioConfig: UpdateLmStudioSettingsInput): Promise<SearchResponse> {
    const ftsQuery = sanitizeFtsQuery(query);
    const repositoryKeywordMatches = this.catalogService.keywordSearchRepositories(ftsQuery, limit * 4);
    const chunkKeywordMatches = this.catalogService.keywordSearchChunks(ftsQuery, limit * 8);
    const allChunks = this.catalogService.getAllChunkRows();
    const client = new LMStudioClient(lmStudioConfig);
    const [queryEmbedding] = await client.embed([query]);

    const scoreMap = new Map<number, {
      score: number;
      reasons: Set<string>;
      evidenceSnippets: string[];
      matchedDocumentKinds: Set<string>;
    }>();

    for (const match of repositoryKeywordMatches) {
      const entry = scoreMap.get(match.repositoryId) ?? {
        score: 0,
        reasons: new Set<string>(),
        evidenceSnippets: [],
        matchedDocumentKinds: new Set<string>(),
      };
      entry.score += reciprocalRankScore(match.rank) * 1.15;
      entry.reasons.add('repository metadata keyword match');
      scoreMap.set(match.repositoryId, entry);
    }

    for (const match of chunkKeywordMatches) {
      const entry = scoreMap.get(match.repositoryId) ?? {
        score: 0,
        reasons: new Set<string>(),
        evidenceSnippets: [],
        matchedDocumentKinds: new Set<string>(),
      };
      entry.score += reciprocalRankScore(match.rank) * 0.95;
      entry.reasons.add('document keyword match');
      entry.matchedDocumentKinds.add(match.kind);
      if (entry.evidenceSnippets.length < 3) {
        entry.evidenceSnippets.push(match.snippet.replaceAll('[', '').replaceAll(']', ''));
      }
      scoreMap.set(match.repositoryId, entry);
    }

    const vectorMatches = allChunks
      .map((chunk) => ({
        repositoryId: chunk.repository_id,
        kind: chunk.kind,
        snippet: chunk.content.slice(0, 220),
        score: cosineSimilarity(queryEmbedding ?? [], JSON.parse(chunk.embedding_json) as number[]),
      }))
      .filter((match) => Number.isFinite(match.score) && match.score > 0.12)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit * 12);

    vectorMatches.forEach((match, index) => {
      const entry = scoreMap.get(match.repositoryId) ?? {
        score: 0,
        reasons: new Set<string>(),
        evidenceSnippets: [],
        matchedDocumentKinds: new Set<string>(),
      };
      entry.score += match.score * 2.4 + reciprocalRankScore(index) * 0.4;
      entry.reasons.add('semantic vector similarity');
      entry.matchedDocumentKinds.add(match.kind);
      if (entry.evidenceSnippets.length < 3) {
        entry.evidenceSnippets.push(match.snippet);
      }
      scoreMap.set(match.repositoryId, entry);
    });

    const rankedIds = Array.from(scoreMap.entries())
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, limit)
      .map(([repositoryId]) => repositoryId);

    const repositories = this.catalogService.getRepositoryByIds(rankedIds);
    const results: SearchResult[] = rankedIds
      .map((repositoryId) => {
        const repository = repositories.get(repositoryId);
        const match = scoreMap.get(repositoryId);
        if (!repository || !match) {
          return null;
        }

        return {
          repository,
          score: Number(match.score.toFixed(4)),
          reasons: Array.from(match.reasons),
          evidenceSnippets: match.evidenceSnippets.slice(0, 3),
          matchedDocumentKinds: Array.from(match.matchedDocumentKinds),
        };
      })
      .filter((value): value is SearchResult => value !== null);

    return {
      query,
      results,
    };
  }
}
