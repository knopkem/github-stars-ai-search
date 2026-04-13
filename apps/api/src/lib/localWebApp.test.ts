import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocalWebRequestTarget } from './localWebApp.js';

const tempDirectories: string[] = [];

function createWebDistFixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'github-stars-ai-search-web-'));
  tempDirectories.push(directory);

  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(directory, 'assets', 'index.js'), 'console.log("ok");');

  return directory;
}

describe('localWebApp', () => {
  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('resolves existing asset files from the web dist folder', () => {
    const webDistPath = createWebDistFixture();

    expect(getLocalWebRequestTarget(webDistPath, '/assets/index.js')).toEqual({
      type: 'file',
      filePath: path.join(webDistPath, 'assets', 'index.js'),
    });
  });

  it('falls back to index for client-side routes without a file extension', () => {
    const webDistPath = createWebDistFixture();

    expect(getLocalWebRequestTarget(webDistPath, '/catalog/repositories')).toEqual({
      type: 'index',
    });
  });

  it('returns not-found for missing asset files and traversal attempts', () => {
    const webDistPath = createWebDistFixture();

    expect(getLocalWebRequestTarget(webDistPath, '/assets/missing.js')).toEqual({
      type: 'not-found',
    });
    expect(getLocalWebRequestTarget(webDistPath, '/../secret.txt')).toEqual({
      type: 'not-found',
    });
  });
});
