# GitHub Stars AI Search

Local-first GitHub stars management with a Node API, a React frontend, and LM Studio-powered RAG search.

## What it does

- Sync your starred repositories from GitHub
- Fetch README content, release notes, and high-signal manifest files
- Generate summaries, tags, and platform hints with LM Studio
- Store chunk embeddings for hybrid semantic + keyword search
- Track releases and filter assets by saved keywords
- Export and import the local catalog as JSON

## Tech stack

- **API:** Fastify + TypeScript + better-sqlite3
- **Frontend:** React + Vite + TypeScript + TanStack Query
- **Shared contracts:** Zod
- **LLM runtime:** LM Studio (OpenAI-compatible chat + embeddings endpoints)

## Workspace layout

- `apps/api` - Fastify API and local SQLite persistence
- `apps/web` - React frontend
- `packages/shared` - shared schemas and DTOs

## Requirements

- Node.js 22+
- pnpm 10+
- LM Studio running locally
- A GitHub personal access token with access to starred repositories

## Development

```bash
pnpm install
pnpm dev
```

That starts:

- shared package type build watch
- API at `http://127.0.0.1:3001`
- frontend at `http://127.0.0.1:5173`

## Production-style build

```bash
pnpm build
pnpm --filter @github-stars-ai-search/api start
pnpm --filter @github-stars-ai-search/web preview
```

The API remains localhost-only by default and stores data in `./data/app.db`.

## First-run setup

1. Open the frontend
2. Save a GitHub token in **Settings**
3. Configure LM Studio base URL, chat model, and embedding model
4. Test LM Studio connectivity
5. Click **Sync and index catalog**
6. Search the catalog from the **Catalog** view

## Notes

- LM Studio must point to a loopback URL such as `http://127.0.0.1:1234` or `http://127.0.0.1:1234/v1`
- The GitHub token is stored only on the local API server and encrypted at rest
- The browser never persists the GitHub token
- Import/export intentionally does not carry secrets
