import { ensureDataDirectory, loadConfig, loadOrCreateMasterKey } from './config.js';
import { buildApp } from './app.js';

async function start(): Promise<void> {
  const config = loadConfig();
  await ensureDataDirectory(config);
  const masterKey = await loadOrCreateMasterKey(config);
  const app = await buildApp(masterKey);

  await app.listen({
    host: '127.0.0.1',
    port: config.port,
  });

  app.log.info(`github-stars-ai-search API listening on http://127.0.0.1:${config.port}`);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
