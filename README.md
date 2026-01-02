# Friday v2 (staging)

Friday v2 is a context-first personal assistant UI: the product is mostly **documents + tooling** rather than application logic.

**Core idea**
- Before answering a user prompt, Friday loads a set of Markdown context files in a deterministic order (similar to `AGENTS.md` scoping).
- The chat UI is a thin wrapper that:
  - stores chats/messages,
  - shows loaded context,
  - (later) invokes a model/runner (e.g. Codex CLI) using that context.

This folder is staged inside `telegraph` due to sandboxing; when ready, move it to its own repo.

## Local dev

Install dependencies:

```sh
npm install
```

Run the backend API (port `3333` by default):

```sh
npm run dev:server
```

Run the web UI (Vite dev server on `5178`):

```sh
npm run dev:web
```

## Production-ish run

Build the UI and run the server:

```sh
npm run build
npm start
```

Server serves the built UI from `apps/web/dist`.

## Connect the Codex runner

1) Create `.env`:

```sh
cp .env.example .env
```

2) Set `FRIDAY_RUNNER=codex` and (if needed) `CODEX_PATH=...`.

3) In the UI: Settings → Accounts → add an account → “Login with code” → set active.

## Structure

- `friday-v2/ai-context/` ordered context files (loaded in lexicographic order)
- `friday-v2/server/` Node API server (modular, SQLite)
- `friday-v2/apps/web/` Vite + React UI (SCSS, lucide icons)
- `friday-v2/data/` SQLite database (created at runtime)
- `friday-v2/runbooks/` ops + product docs (incl. Trello card draft)
