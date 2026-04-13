import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  assetFilterSchema,
  exportPayloadSchema,
  type AssetFilterRecord,
  type ExportPayload,
  type ReleaseRecord,
  type RepositoryRecord,
} from '@github-stars-ai-search/shared';
import type { SourceDocument } from '../lib/chunking.js';
import type { ChunkRow, DocumentRow, ReleaseRow, RepositoryRow } from '../lib/db.js';
import { cosineSimilarity, type RankedVectorMatch } from '../lib/search.js';

function parseJsonArray<T>(value: string): T[] {
  try {
    return JSON.parse(value) as T[];
  } catch {
    return [];
  }
}

function repositoryFromRow(row: RepositoryRow): RepositoryRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    name: row.name,
    ownerLogin: row.owner_login,
    ownerAvatarUrl: row.owner_avatar_url ?? null,
    description: row.description,
    htmlUrl: row.html_url,
    stargazerCount: row.stargazer_count,
    language: row.language,
    topics: parseJsonArray<string>(row.topics_json),
    defaultBranch: row.default_branch,
    pushedAt: row.pushed_at,
    starredAt: row.starred_at,
    summary: row.summary,
    tags: parseJsonArray<string>(row.tags_json),
    platforms: parseJsonArray<RepositoryRecord['platforms'][number]>(row.platforms_json),
    watchReleases: !!row.watch_releases,
    indexedAt: row.indexed_at,
  };
}

function releaseFromRow(row: ReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    repositoryFullName: row.repository_full_name,
    tagName: row.tag_name,
    name: row.name,
    body: row.body,
    publishedAt: row.published_at,
    htmlUrl: row.html_url,
    isPrerelease: !!row.is_prerelease,
    isDraft: !!row.is_draft,
    assets: parseJsonArray<ReleaseRecord['assets'][number]>(row.assets_json),
  };
}

export interface PersistedChunk {
  repositoryId: number;
  documentIndex: number;
  kind: string;
  path: string | null;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

interface SearchableChunk {
  id: number;
  repositoryId: number;
  kind: string;
  snippet: string;
  embedding: Float32Array;
}

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

type SqliteRow = Record<string, SQLOutputValue>;

function typedRows<T>(rows: SqliteRow[]): T[] {
  return rows as unknown as T[];
}

function typedRow<T>(row: SqliteRow | undefined): T | undefined {
  return row as unknown as T | undefined;
}

export class CatalogService {
  private searchableChunksCache: SearchableChunk[] | null = null;

  private readonly parsedEmbeddingCache = new Map<number, Float32Array>();

  constructor(private readonly db: DatabaseSync) {}

  private invalidateChunkCaches(): void {
    this.searchableChunksCache = null;
    this.parsedEmbeddingCache.clear();
  }

  private getParsedEmbedding(chunkId: number, embeddingJson: string): Float32Array {
    const cached = this.parsedEmbeddingCache.get(chunkId);
    if (cached) {
      return cached;
    }

    const parsed = parseJsonArray<number>(embeddingJson).map((value) => (Number.isFinite(value) ? value : 0));
    const embedding = Float32Array.from(parsed);
    this.parsedEmbeddingCache.set(chunkId, embedding);
    return embedding;
  }

  private getSearchableChunks(): SearchableChunk[] {
    if (this.searchableChunksCache) {
      return this.searchableChunksCache;
    }

    const rows = this.getAllChunkRows();
    this.searchableChunksCache = rows.map((row) => ({
      id: row.id,
      repositoryId: row.repository_id,
      kind: row.kind,
      snippet: row.content.slice(0, 220),
      embedding: this.getParsedEmbedding(row.id, row.embedding_json),
    }));
    return this.searchableChunksCache;
  }

  listRepositories(): RepositoryRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM repositories ORDER BY stargazer_count DESC, full_name ASC')
      .all();
    const typed = typedRows<RepositoryRow>(rows);
    return typed.map(repositoryFromRow);
  }

  listReleases(watchOnly: boolean): ReleaseRecord[] {
    const sql = watchOnly
      ? `SELECT r.* FROM releases r JOIN repositories repo ON repo.id = r.repository_id WHERE repo.watch_releases = 1 ORDER BY COALESCE(r.published_at, '') DESC`
      : `SELECT * FROM releases ORDER BY COALESCE(published_at, '') DESC`;
    const rows = typedRows<ReleaseRow>(this.db.prepare(sql).all());
    return rows.map(releaseFromRow);
  }

  listAssetFilters(): AssetFilterRecord[] {
    const rows = typedRows<AssetFilterRecord>(this.db.prepare('SELECT id, keyword FROM asset_filters ORDER BY keyword ASC').all());
    return rows.map((row) => assetFilterSchema.parse(row));
  }

  addAssetFilter(keyword: string): AssetFilterRecord {
    const normalized = keyword.trim().toLowerCase();
    const result = this.db.prepare('INSERT OR IGNORE INTO asset_filters (keyword) VALUES (?)').run(normalized);
    if (result.changes === 0) {
      const existing = typedRow<AssetFilterRecord>(this.db.prepare('SELECT id, keyword FROM asset_filters WHERE keyword = ?').get(normalized));
      if (!existing) {
        throw new Error('Unable to load the existing asset filter after insert.');
      }
      return assetFilterSchema.parse(existing);
    }
    const inserted = typedRow<AssetFilterRecord>(this.db.prepare('SELECT id, keyword FROM asset_filters WHERE keyword = ?').get(normalized));
    if (!inserted) {
      throw new Error('Unable to load the inserted asset filter.');
    }
    return assetFilterSchema.parse(inserted);
  }

  deleteAssetFilter(id: number): void {
    this.db.prepare('DELETE FROM asset_filters WHERE id = ?').run(id);
  }

  setWatchReleases(repositoryId: number, watchReleases: boolean): void {
    this.db.prepare('UPDATE repositories SET watch_releases = ? WHERE id = ?').run(watchReleases ? 1 : 0, repositoryId);
  }

  upsertRepository(repository: RepositoryRecord): void {
    this.db.prepare(`
      INSERT INTO repositories (
        id, full_name, name, owner_login, owner_avatar_url, description, html_url, stargazer_count, language, topics_json,
        default_branch, pushed_at, starred_at, summary, tags_json, platforms_json, watch_releases, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        name = excluded.name,
        owner_login = excluded.owner_login,
        owner_avatar_url = excluded.owner_avatar_url,
        description = excluded.description,
        html_url = excluded.html_url,
        stargazer_count = excluded.stargazer_count,
        language = excluded.language,
        topics_json = excluded.topics_json,
        default_branch = excluded.default_branch,
        pushed_at = excluded.pushed_at,
        starred_at = excluded.starred_at,
        summary = excluded.summary,
        tags_json = excluded.tags_json,
        platforms_json = excluded.platforms_json,
        indexed_at = excluded.indexed_at
    `).run(
      repository.id,
      repository.fullName,
      repository.name,
      repository.ownerLogin,
      repository.ownerAvatarUrl ?? null,
      repository.description,
      repository.htmlUrl,
      repository.stargazerCount,
      repository.language,
      JSON.stringify(repository.topics),
      repository.defaultBranch,
      repository.pushedAt,
      repository.starredAt,
      repository.summary,
      JSON.stringify(repository.tags),
      JSON.stringify(repository.platforms),
      repository.watchReleases ? 1 : 0,
      repository.indexedAt,
    );

    this.db.prepare('DELETE FROM repository_fts WHERE rowid = ?').run(repository.id);
    this.db.prepare(`
      INSERT INTO repository_fts (rowid, full_name, name, description, topics, summary, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      repository.id,
      repository.fullName,
      repository.name,
      repository.description ?? '',
      repository.topics.join(' '),
      repository.summary ?? '',
      repository.tags.join(' '),
    );
  }

  replaceReleases(repositoryId: number, repositoryFullName: string, releases: ReleaseRecord[]): void {
    withTransaction(this.db, () => {
      this.db.prepare('DELETE FROM releases WHERE repository_id = ?').run(repositoryId);
      const statement = this.db.prepare(`
        INSERT INTO releases (
          id, repository_id, repository_full_name, tag_name, name, body, published_at, html_url, is_prerelease, is_draft, assets_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const release of releases) {
        statement.run(
          release.id,
          repositoryId,
          repositoryFullName,
          release.tagName,
          release.name,
          release.body,
          release.publishedAt,
          release.htmlUrl,
          release.isPrerelease ? 1 : 0,
          release.isDraft ? 1 : 0,
          JSON.stringify(release.assets),
        );
      }
    });
  }

  replaceDocumentsAndChunks(
    repositoryId: number,
    documents: SourceDocument[],
    chunks: PersistedChunk[],
  ): void {
    withTransaction(this.db, () => {
      const existingDocuments = this.db
        .prepare('SELECT id FROM documents WHERE repository_id = ?')
        .all(repositoryId) as Array<{ id: number }>;

      for (const document of existingDocuments) {
        this.db.prepare('DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)').run(document.id);
      }

      this.db.prepare('DELETE FROM chunks WHERE repository_id = ?').run(repositoryId);
      this.db.prepare('DELETE FROM documents WHERE repository_id = ?').run(repositoryId);

      const documentInsert = this.db.prepare(`
        INSERT INTO documents (repository_id, kind, path, title, content)
        VALUES (?, ?, ?, ?, ?)
      `);
      const chunkInsert = this.db.prepare(`
        INSERT INTO chunks (repository_id, document_id, kind, path, chunk_index, content, embedding_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const ftsInsert = this.db.prepare(`
        INSERT INTO chunk_fts (rowid, repository_id, kind, path, content)
        VALUES (?, ?, ?, ?, ?)
      `);

      const documentIds: number[] = [];
      for (const document of documents) {
        const result = documentInsert.run(repositoryId, document.kind, document.path, document.title, document.content);
        documentIds.push(Number(result.lastInsertRowid));
      }

      for (const chunk of chunks) {
        const documentId = documentIds[chunk.documentIndex];
        if (!documentId) {
          continue;
        }
        const result = chunkInsert.run(
          repositoryId,
          documentId,
          chunk.kind,
          chunk.path,
          chunk.chunkIndex,
          chunk.content,
          JSON.stringify(chunk.embedding),
        );
        const rowid = Number(result.lastInsertRowid);
        ftsInsert.run(rowid, repositoryId, chunk.kind, chunk.path, chunk.content);
      }
    });
    this.invalidateChunkCaches();
  }

  deleteRepositoriesMissingFrom(validRepositoryIds: number[]): void {
    if (validRepositoryIds.length === 0) {
      this.db.exec(`
        DELETE FROM chunk_fts;
        DELETE FROM repository_fts;
        DELETE FROM chunks;
        DELETE FROM documents;
        DELETE FROM releases;
        DELETE FROM repositories;
      `);
      this.invalidateChunkCaches();
      return;
    }

    const placeholders = validRepositoryIds.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM chunk_fts WHERE repository_id NOT IN (${placeholders})`).run(...validRepositoryIds);
    this.db.prepare(`DELETE FROM repository_fts WHERE rowid NOT IN (${placeholders})`).run(...validRepositoryIds);
    this.db.prepare(`DELETE FROM repositories WHERE id NOT IN (${placeholders})`).run(...validRepositoryIds);
    this.invalidateChunkCaches();
  }

  updateFacets(repositoryId: number, summary: string, tags: string[], platforms: string[], indexedAt: string): void {
    this.db.prepare(`
      UPDATE repositories
      SET summary = ?, tags_json = ?, platforms_json = ?, indexed_at = ?
      WHERE id = ?
    `).run(summary, JSON.stringify(tags), JSON.stringify(platforms), indexedAt, repositoryId);

    const row = typedRow<RepositoryRow>(this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(repositoryId));
    if (row) {
      this.db.prepare('DELETE FROM repository_fts WHERE rowid = ?').run(repositoryId);
      this.db.prepare(`
        INSERT INTO repository_fts (rowid, full_name, name, description, topics, summary, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        repositoryId,
        row.full_name,
        row.name,
        row.description ?? '',
        parseJsonArray<string>(row.topics_json).join(' '),
        summary,
        tags.join(' '),
      );
    }
  }

  getAllChunkRows(): ChunkRow[] {
    return typedRows<ChunkRow>(this.db.prepare('SELECT * FROM chunks').all());
  }

  rankChunkVectors(queryEmbedding: ArrayLike<number>, limit: number, minScore: number): RankedVectorMatch[] {
    if (limit <= 0 || queryEmbedding.length === 0) {
      return [];
    }

    return this.getSearchableChunks()
      .map((chunk) => ({
        chunkId: chunk.id,
        repositoryId: chunk.repositoryId,
        kind: chunk.kind,
        snippet: chunk.snippet,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .filter((match) => Number.isFinite(match.score) && match.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ chunkId: _chunkId, ...match }) => match);
  }

  getRepositoryByIds(ids: number[]): Map<number, RepositoryRecord> {
    if (ids.length === 0) {
      return new Map();
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = typedRows<RepositoryRow>(this.db.prepare(`SELECT * FROM repositories WHERE id IN (${placeholders})`).all(...ids));
    return new Map(rows.map((row) => [row.id, repositoryFromRow(row)]));
  }

  keywordSearchRepositories(matchQuery: string, limit: number): Array<{ repositoryId: number; rank: number }> {
    if (!matchQuery.trim()) {
      return [];
    }

    const rows = this.db
      .prepare(`
        SELECT rowid as repositoryId
        FROM repository_fts
        WHERE repository_fts MATCH ?
        LIMIT ?
      `)
      .all(matchQuery, limit);
    const typed = typedRows<{ repositoryId: number }>(rows);
    return typed.map((row, index) => ({ repositoryId: row.repositoryId, rank: index }));
  }

  keywordSearchChunks(matchQuery: string, limit: number): Array<{ repositoryId: number; rank: number; snippet: string; kind: string }> {
    if (!matchQuery.trim()) {
      return [];
    }

    const rows = this.db
      .prepare(`
        SELECT rowid as chunkId, repository_id, kind, snippet(chunk_fts, 3, '[', ']', '…', 18) as snippet
        FROM chunk_fts
        WHERE chunk_fts MATCH ?
        LIMIT ?
      `)
      .all(matchQuery, limit);
    const typed = typedRows<{ chunkId: number; repository_id: number; kind: string; snippet: string }>(rows);

    return typed.map((row, index) => ({
      repositoryId: row.repository_id,
      rank: index,
      snippet: row.snippet,
      kind: row.kind,
    }));
  }

  exportCatalog(lmStudio: { baseUrl: string; chatModel: string; embeddingModel: string; concurrency?: number } | null): ExportPayload {
    const repositories = this.listRepositories();
    const releases = this.listReleases(false);
    const assetFilters = this.listAssetFilters();
    const documents = typedRows<DocumentRow>(this.db.prepare('SELECT * FROM documents').all());
    const chunks = this.getAllChunkRows().map((row) => ({
      id: row.id,
      repositoryId: row.repository_id,
      documentId: row.document_id,
      kind: row.kind,
      path: row.path,
      chunkIndex: row.chunk_index,
      content: row.content,
      embedding: parseJsonArray<number>(row.embedding_json),
    }));

    return exportPayloadSchema.parse({
      version: 1,
      exportedAt: new Date().toISOString(),
      repositories,
      releases,
      assetFilters,
      documents: documents.map((document) => ({
        id: document.id,
        repositoryId: document.repository_id,
        kind: document.kind,
        path: document.path,
        title: document.title,
        content: document.content,
      })),
      chunks,
      lmStudio,
    });
  }

  importCatalog(payload: ExportPayload): void {
    withTransaction(this.db, () => {
      this.db.exec(`
        DELETE FROM chunk_fts;
        DELETE FROM repository_fts;
        DELETE FROM chunks;
        DELETE FROM documents;
        DELETE FROM releases;
        DELETE FROM repositories;
        DELETE FROM asset_filters;
      `);

      for (const repository of payload.repositories) {
        this.upsertRepository(repository);
      }

      for (const release of payload.releases) {
        this.db.prepare(`
          INSERT INTO releases (
            id, repository_id, repository_full_name, tag_name, name, body, published_at, html_url, is_prerelease, is_draft, assets_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          release.id,
          release.repositoryId,
          release.repositoryFullName,
          release.tagName,
          release.name,
          release.body,
          release.publishedAt,
          release.htmlUrl,
          release.isPrerelease ? 1 : 0,
          release.isDraft ? 1 : 0,
          JSON.stringify(release.assets),
        );
      }

      for (const filter of payload.assetFilters) {
        this.db.prepare('INSERT INTO asset_filters (id, keyword) VALUES (?, ?)').run(filter.id, filter.keyword);
      }

      for (const document of payload.documents) {
        this.db.prepare(`
          INSERT INTO documents (id, repository_id, kind, path, title, content)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(document.id, document.repositoryId, document.kind, document.path, document.title, document.content);
      }

      for (const chunk of payload.chunks) {
        this.db.prepare(`
          INSERT INTO chunks (id, repository_id, document_id, kind, path, chunk_index, content, embedding_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          chunk.id,
          chunk.repositoryId,
          chunk.documentId,
          chunk.kind,
          chunk.path,
          chunk.chunkIndex,
          chunk.content,
          JSON.stringify(chunk.embedding),
        );
        this.db.prepare(`
          INSERT INTO chunk_fts (rowid, repository_id, kind, path, content)
          VALUES (?, ?, ?, ?, ?)
        `).run(chunk.id, chunk.repositoryId, chunk.kind, chunk.path, chunk.content);
      }
    });
    this.invalidateChunkCaches();
  }

  getUnanalyzedRepositoryIds(): number[] {
    const rows = typedRows<{ id: number }>(this.db.prepare('SELECT id FROM repositories WHERE indexed_at IS NULL').all());
    return rows.map((r) => r.id);
  }

  getAllRepositoryIds(): number[] {
    const rows = typedRows<{ id: number }>(this.db.prepare('SELECT id FROM repositories').all());
    return rows.map((r) => r.id);
  }

  markRepositoriesStale(repositoryIds: number[]): void {
    if (repositoryIds.length === 0) return;
    const placeholders = repositoryIds.map(() => '?').join(',');
    this.db.prepare(`UPDATE repositories SET indexed_at = NULL WHERE id IN (${placeholders})`).run(...repositoryIds);
  }

  resetAnalysisForRepositories(repositoryIds: number[]): void {
    if (repositoryIds.length === 0) return;
    const placeholders = repositoryIds.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE repository_id IN (${placeholders}))`).run(...repositoryIds);
    this.db.prepare(`DELETE FROM chunks WHERE repository_id IN (${placeholders})`).run(...repositoryIds);
    this.db.prepare(`DELETE FROM documents WHERE repository_id IN (${placeholders})`).run(...repositoryIds);
    this.db.prepare(`UPDATE repositories SET indexed_at = NULL, summary = NULL, tags_json = '[]', platforms_json = '[]' WHERE id IN (${placeholders})`).run(...repositoryIds);
    this.invalidateChunkCaches();
  }

  getRepositoryById(id: number): RepositoryRecord | null {
    const row = typedRow<RepositoryRow>(this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(id));
    return row ? repositoryFromRow(row) : null;
  }

  getStats(): { totalRepositories: number; indexedRepositories: number; totalChunks: number; totalReleases: number } {
    const totalRepositories = (this.db.prepare('SELECT COUNT(*) as count FROM repositories').get() as { count: number }).count;
    const indexedRepositories = (this.db.prepare('SELECT COUNT(*) as count FROM repositories WHERE indexed_at IS NOT NULL').get() as { count: number }).count;
    const totalChunks = (this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
    const totalReleases = (this.db.prepare('SELECT COUNT(*) as count FROM releases').get() as { count: number }).count;
    return { totalRepositories, indexedRepositories, totalChunks, totalReleases };
  }
}
