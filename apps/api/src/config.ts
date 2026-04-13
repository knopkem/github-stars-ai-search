import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export interface AppConfig {
  port: number;
  workspaceRoot: string;
  dataDir: string;
  databasePath: string;
  secretKeyPath: string;
  allowedOrigins: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    if (existsSync(path.join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Unable to locate workspace root for github-stars-ai-search.');
    }
    currentDir = parentDir;
  }
}

export function loadConfig(): AppConfig {
  const workspaceRoot = findWorkspaceRoot(__dirname);
  const dataDir = path.join(workspaceRoot, 'data');
  const databasePath = path.join(dataDir, 'app.db');
  const secretKeyPath = path.join(dataDir, 'master.key');
  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
      : [
          'http://127.0.0.1:5173',
          'http://localhost:5173',
          'http://127.0.0.1:4173',
          'http://localhost:4173',
          `http://127.0.0.1:${port}`,
          `http://localhost:${port}`,
        ];

  return {
    port,
    workspaceRoot,
    dataDir,
    databasePath,
    secretKeyPath,
    allowedOrigins,
  };
}

export async function ensureDataDirectory(config: AppConfig): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
}

export async function loadOrCreateMasterKey(config: AppConfig): Promise<Buffer> {
  await ensureDataDirectory(config);
  if (existsSync(config.secretKeyPath)) {
    const existing = await readFile(config.secretKeyPath, 'utf8');
    return Buffer.from(existing.trim(), 'base64');
  }

  const generated = crypto.randomBytes(32);
  await writeFile(config.secretKeyPath, generated.toString('base64'), { mode: 0o600 });
  return generated;
}
