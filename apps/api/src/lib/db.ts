import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';

export interface RepositoryRow {
  id: number;
  full_name: string;
  name: string;
  owner_login: string;
  owner_avatar_url: string | null;
  description: string | null;
  html_url: string;
  stargazer_count: number;
  language: string | null;
  topics_json: string;
  default_branch: string | null;
  pushed_at: string | null;
  starred_at: string | null;
  summary: string | null;
  tags_json: string;
  platforms_json: string;
  watch_releases: number;
  indexed_at: string | null;
}

export interface ReleaseRow {
  id: number;
  repository_id: number;
  repository_full_name: string;
  tag_name: string;
  name: string;
  body: string;
  published_at: string | null;
  html_url: string;
  is_prerelease: number;
  is_draft: number;
  assets_json: string;
}

export interface DocumentRow {
  id: number;
  repository_id: number;
  kind: string;
  path: string | null;
  title: string;
  content: string;
}

export interface ChunkRow {
  id: number;
  repository_id: number;
  document_id: number;
  kind: string;
  path: string | null;
  chunk_index: number;
  content: string;
  embedding_json: string;
}

export function createDatabase(config: AppConfig): DatabaseSync {
  const db = new DatabaseSync(config.databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_login TEXT NOT NULL,
      description TEXT,
      html_url TEXT NOT NULL,
      stargazer_count INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      topics_json TEXT NOT NULL DEFAULT '[]',
      default_branch TEXT,
      pushed_at TEXT,
      starred_at TEXT,
      summary TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      platforms_json TEXT NOT NULL DEFAULT '[]',
      watch_releases INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY,
      repository_id INTEGER NOT NULL,
      repository_full_name TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      html_url TEXT NOT NULL,
      is_prerelease INTEGER NOT NULL DEFAULT 0,
      is_draft INTEGER NOT NULL DEFAULT 0,
      assets_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      path TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      path TEXT,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS repository_fts USING fts5(
      full_name,
      name,
      description,
      topics,
      summary,
      tags
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      repository_id UNINDEXED,
      kind,
      path,
      content
    );
  `);

  // Migration: add owner_avatar_url column if missing
  try {
    db.exec(`ALTER TABLE repositories ADD COLUMN owner_avatar_url TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: flip watch_releases default from opt-out to opt-in
  // Uses a one-shot marker so it only runs once on existing databases
  try {
    db.exec(`ALTER TABLE repositories ADD COLUMN _watch_migration_done INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE repositories SET watch_releases = 0`);
    db.exec(`ALTER TABLE repositories DROP COLUMN _watch_migration_done`);
  } catch {
    // Migration already ran
  }

  return db;
}
