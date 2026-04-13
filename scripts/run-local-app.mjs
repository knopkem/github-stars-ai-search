#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = new Set(process.argv.slice(2));
const shouldRebuild = args.has('--rebuild');
const shouldOpenBrowser = !args.has('--no-open');
const port = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001;
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const healthUrl = `${baseUrl}/api/health`;
const requiredArtifacts = [
  path.join(workspaceRoot, 'packages', 'shared', 'dist', 'index.js'),
  path.join(workspaceRoot, 'apps', 'api', 'dist', 'index.js'),
  path.join(workspaceRoot, 'apps', 'web', 'dist', 'index.html'),
];

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCommand(command, commandArgs, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: workspaceRoot,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        signal
          ? `${command} ${commandArgs.join(' ')} exited with signal ${signal}.`
          : `${command} ${commandArgs.join(' ')} exited with code ${code ?? 'unknown'}.`,
      ));
    });
  });
}

async function ensureBuildArtifacts() {
  const artifactsMissing = requiredArtifacts.some((artifactPath) => !existsSync(artifactPath));
  if (!shouldRebuild && !artifactsMissing) {
    return;
  }

  console.log(shouldRebuild ? 'Rebuilding local app…' : 'Building local app…');
  await runCommand(pnpmCommand, ['build']);
}

function ensurePortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Stop the other local server or run with PORT=<free-port> pnpm app.`));
        return;
      }
      reject(error);
    });

    probe.once('listening', () => {
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });

    probe.listen(port, host);
  });
}

async function waitForHealthcheck(serverProcess) {
  const timeoutAt = Date.now() + 45_000;

  while (Date.now() < timeoutAt) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`The local app exited before becoming ready (exit code ${serverProcess.exitCode}).`);
    }

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for the local app at ${healthUrl}.`);
}

function openBrowser(url) {
  if (process.platform === 'darwin') {
    return spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  }

  if (process.platform === 'win32') {
    return spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }

  return spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  await ensureBuildArtifacts();
  await ensurePortAvailable();

  const serverProcess = spawn(pnpmCommand, ['--filter', '@github-stars-ai-search/api', 'start'], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SERVE_WEB: '1',
    },
    stdio: 'inherit',
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (serverProcess.exitCode === null) {
      serverProcess.kill(signal);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await waitForHealthcheck(serverProcess);
  console.log(`Local app ready at ${baseUrl}`);

  if (shouldOpenBrowser) {
    try {
      openBrowser(baseUrl);
    } catch (error) {
      console.warn(`Unable to open a browser automatically: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await new Promise((resolve, reject) => {
    serverProcess.on('error', reject);
    serverProcess.on('exit', (code, signal) => {
      if (shuttingDown && (signal === 'SIGINT' || signal === 'SIGTERM' || code === 0 || code === null)) {
        resolve();
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        signal
          ? `The local app exited with signal ${signal}.`
          : `The local app exited with code ${code ?? 'unknown'}.`,
      ));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
