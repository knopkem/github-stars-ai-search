import { z } from 'zod';
import type { UpdateLmStudioSettingsInput } from '@github-stars-ai-search/shared';
import { LMStudioClient } from './lmStudio.js';

const SAFE_QUERY_CHARACTERS = /[^\p{L}\p{N}\s-]/gu;

const queryAnalysisSchema = z.object({
  type: z.enum(['simple', 'semantic', 'complex']),
  expandedQuery: z.string().trim().min(1),
  keywords: z.array(z.string()).default([]),
  intent: z.string().trim().min(1),
  hypotheticalDocument: z.string().trim().min(1).optional(),
});

export type QueryAnalysisResult = z.infer<typeof queryAnalysisSchema>;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeKeyword(value: string): string {
  return normalizeText(value.replace(SAFE_QUERY_CHARACTERS, ' '));
}

function dedupeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (normalized.length <= 1) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    keywords.push(normalized);
    if (keywords.length >= 10) {
      break;
    }
  }

  return keywords;
}

function extractFallbackKeywords(query: string): string[] {
  return dedupeKeywords(
    query
      .replace(/"([^"]+)"/g, '$1 ')
      .replace(SAFE_QUERY_CHARACTERS, ' ')
      .split(/\s+/),
  );
}

function fallbackAnalysis(query: string): QueryAnalysisResult {
  const normalizedQuery = normalizeText(query);
  const keywords = extractFallbackKeywords(query);
  const wordCount = normalizedQuery.split(/\s+/).filter(Boolean).length;
  const hasBooleanOperators = /\b(?:and|or|not)\b/i.test(normalizedQuery);
  const hasQuotedPhrase = /"/.test(query);
  const hasQuestion = /[?!]/.test(query);

  let type: QueryAnalysisResult['type'] = 'simple';
  if (hasBooleanOperators || hasQuotedPhrase || wordCount >= 9) {
    type = 'complex';
  } else if (hasQuestion || wordCount >= 5) {
    type = 'semantic';
  }

  const intent = keywords.length > 0
    ? `Find repositories related to ${keywords.slice(0, 3).join(', ')}`
    : `Find repositories relevant to ${normalizedQuery}`;

  return {
    type,
    expandedQuery: normalizedQuery,
    keywords,
    intent,
  };
}

export async function generateHypotheticalDocument(
  query: string,
  intent: string,
  lmStudioConfig: UpdateLmStudioSettingsInput,
): Promise<string> {
  const client = new LMStudioClient(lmStudioConfig);
  const response = await client.chat(
    [
      'Write a concise hypothetical repository document that would satisfy this search intent.',
      `User query: ${query}`,
      `Intent: ${intent}`,
      'Return only the document text in 3-5 sentences.',
    ].join('\n'),
    'You create short retrieval documents for semantic search.',
    220,
  );

  const normalized = normalizeText(response);
  if (!normalized) {
    throw new Error('LM Studio returned an empty hypothetical document.');
  }

  return normalized;
}

export async function analyzeQuery(
  query: string,
  lmStudioConfig: UpdateLmStudioSettingsInput,
): Promise<QueryAnalysisResult> {
  const fallback = fallbackAnalysis(query);
  if (fallback.type === 'simple') {
    return fallback;
  }

  const client = new LMStudioClient(lmStudioConfig);

  try {
    const response = await client.chatJson(
      [
        'Analyze the user query for repository search routing.',
        'Return strict JSON with keys: type, expandedQuery, keywords, intent, hypotheticalDocument.',
        'type must be one of simple, semantic, complex.',
        'expandedQuery should keep the meaning but improve retrieval.',
        'keywords should be a concise list of search terms.',
        'intent should be a short sentence describing what the user wants.',
        'hypotheticalDocument should be a short 3-5 sentence repository-style document for semantic retrieval when type is semantic or complex. Omit it for simple queries.',
        `Query: ${query}`,
      ].join('\n'),
      'You are a search query analyzer that returns valid JSON only.',
      320,
    );

    const parsed = queryAnalysisSchema.parse(response);
    const keywords = dedupeKeywords(parsed.keywords);
    const expandedQuery = normalizeText(parsed.expandedQuery);
    const intent = normalizeText(parsed.intent);

    let hypotheticalDocument = parsed.hypotheticalDocument
      ? normalizeText(parsed.hypotheticalDocument)
      : undefined;

    if (!hypotheticalDocument && parsed.type !== 'simple') {
      try {
        hypotheticalDocument = await generateHypotheticalDocument(query, intent || fallback.intent, lmStudioConfig);
      } catch {
        hypotheticalDocument = undefined;
      }
    }

    return {
      type: parsed.type,
      expandedQuery: expandedQuery || fallback.expandedQuery,
      keywords: keywords.length > 0 ? keywords : fallback.keywords,
      intent: intent || fallback.intent,
      hypotheticalDocument,
    };
  } catch {
    return fallback;
  }
}
