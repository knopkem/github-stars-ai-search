import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepositoryRecord } from '@github-stars-ai-search/shared';
import type { AppConfig } from '../config.js';
import { createDatabase } from '../lib/db.js';
import { CatalogService } from './catalogService.js';

function createTestRepository(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    id: 1,
    fullName: 'owner/repo-1',
    name: 'repo-1',
    ownerLogin: 'owner',
    ownerAvatarUrl: 'https://example.com/avatar.png',
    description: 'Repository 1',
    htmlUrl: 'https://github.com/owner/repo-1',
    stargazerCount: 42,
    language: 'TypeScript',
    topics: ['sync'],
    defaultBranch: 'main',
    pushedAt: '2024-01-01T00:00:00Z',
    starredAt: '2024-01-02T00:00:00Z',
    summary: 'Already indexed',
    tags: ['stable'],
    platforms: ['web'],
    watchReleases: false,
    needsRefresh: false,
    indexedAt: '2024-01-03T00:00:00Z',
    ...overrides,
  };
}

function createTestCatalogService() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'github-stars-ai-search-'));
  const config: AppConfig = {
    port: 0,
    workspaceRoot: tempDir,
    dataDir: tempDir,
    databasePath: path.join(tempDir, 'test.db'),
    secretKeyPath: path.join(tempDir, 'test.key'),
    allowedOrigins: [],
  };
  const db = createDatabase(config);
  return {
    tempDir,
    db,
    catalogService: new CatalogService(db),
  };
}

describe('CatalogService', () => {
  const cleanupPaths: string[] = [];
  const cleanupDbs: Array<ReturnType<typeof createDatabase>> = [];

  afterEach(() => {
    while (cleanupDbs.length > 0) {
      cleanupDbs.pop()?.close();
    }
    while (cleanupPaths.length > 0) {
      const tempDir = cleanupPaths.pop();
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('keeps indexed snapshots available while marking repositories pending refresh', () => {
    const { tempDir, db, catalogService } = createTestCatalogService();
    cleanupPaths.push(tempDir);
    cleanupDbs.push(db);

    catalogService.upsertRepository(createTestRepository());

    catalogService.markRepositoriesStale([1]);

    const staleRepository = catalogService.getRepositoryById(1);
    expect(staleRepository).toMatchObject({
      needsRefresh: true,
      indexedAt: '2024-01-03T00:00:00Z',
    });
    expect(catalogService.getUnanalyzedRepositoryIds()).toEqual([1]);

    catalogService.updateFacets(1, 'Fresh summary', ['updated'], ['cli'], '2024-02-01T00:00:00Z');

    const refreshedRepository = catalogService.getRepositoryById(1);
    expect(refreshedRepository).toMatchObject({
      summary: 'Fresh summary',
      tags: ['updated'],
      platforms: ['cli'],
      needsRefresh: false,
      indexedAt: '2024-02-01T00:00:00Z',
    });
  });
});
