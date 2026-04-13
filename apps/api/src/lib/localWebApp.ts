import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';

const MIME_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export type LocalWebRequestTarget =
  | { type: 'file'; filePath: string }
  | { type: 'index' }
  | { type: 'not-found' };

function normalizeRequestPath(requestPath: string): string {
  const rawPath = requestPath.split('?')[0] ?? '/';

  let decodedPath = rawPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    // Keep the original path when decoding fails.
  }

  const normalizedInput = decodedPath.replace(/\\/g, '/');
  const relativeInput = normalizedInput.replace(/^\/+/, '');
  if (!relativeInput) {
    return '/';
  }

  const normalizedRelativePath = path.posix.normalize(relativeInput);
  if (normalizedRelativePath === '..' || normalizedRelativePath.startsWith('../')) {
    return '/__invalid__';
  }

  return `/${normalizedRelativePath}`;
}

function resolveCandidateFilePath(webDistPath: string, requestPath: string): string | null {
  const normalizedPath = normalizeRequestPath(requestPath);
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(webDistPath, relativePath);
  const relativeToRoot = path.relative(webDistPath, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return resolvedPath;
}

export function getLocalWebRequestTarget(webDistPath: string, requestPath: string): LocalWebRequestTarget {
  const normalizedPath = normalizeRequestPath(requestPath);

  if (normalizedPath === '/__invalid__') {
    return { type: 'not-found' };
  }

  if (normalizedPath === '/' || normalizedPath === '/index.html') {
    return { type: 'index' };
  }

  const candidateFilePath = resolveCandidateFilePath(webDistPath, normalizedPath);
  if (!candidateFilePath) {
    return { type: 'not-found' };
  }

  if (fs.existsSync(candidateFilePath) && fs.statSync(candidateFilePath).isFile()) {
    return { type: 'file', filePath: candidateFilePath };
  }

  return path.extname(normalizedPath) ? { type: 'not-found' } : { type: 'index' };
}

function getContentType(filePath: string): string {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function sendFile(reply: FastifyReply, filePath: string): FastifyReply {
  reply.type(getContentType(filePath));
  return reply.send(fs.createReadStream(filePath));
}

function getWebDistPath(config: AppConfig): string {
  return path.join(config.workspaceRoot, 'apps', 'web', 'dist');
}

export function shouldServeLocalWebApp(): boolean {
  return process.env.SERVE_WEB === '1';
}

export function registerLocalWebApp(app: FastifyInstance, config: AppConfig): void {
  if (!shouldServeLocalWebApp()) {
    return;
  }

  const webDistPath = getWebDistPath(config);
  const indexFilePath = path.join(webDistPath, 'index.html');
  if (!fs.existsSync(indexFilePath)) {
    throw new Error('Local app mode requires a built frontend. Run `pnpm build` first.');
  }

  const handleLocalWebRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const target = getLocalWebRequestTarget(webDistPath, request.raw.url ?? '/');

    if (target.type === 'not-found') {
      reply.code(404).type('text/plain; charset=utf-8');
      return reply.send('Not found.');
    }

    if (target.type === 'index') {
      reply.header('Cache-Control', 'no-cache');
      return sendFile(reply, indexFilePath);
    }

    return sendFile(reply, target.filePath);
  };

  app.get('/', handleLocalWebRequest);
  app.get('/*', handleLocalWebRequest);
}
