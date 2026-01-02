# Friday v2 (staging)

Friday v2 is a context-first personal assistant UI: the product is mostly **documents + tooling** rather than application logic.

**Core idea**
- Before answering a user prompt, Friday loads a set of Markdown context files in a deterministic order (similar to `AGENTS.md` scoping).
- The chat UI is a thin wrapper that:
  - stores chats/messages,
  - shows loaded context,
  - (later) invokes a model/runner (e.g. Codex CLI) using that context.

This folder is staged inside `telegraph` due to sandboxing; when ready, move it to its own repo.

## Run locally (no deps)

```sh
node friday-v2/server/server.js
```

Then open `http://localhost:3333`.

## Structure

- `friday-v2/ai-context/` ordered context files (loaded in lexicographic order)
- `friday-v2/server/` minimal Node HTTP API + static file server
- `friday-v2/public/` UI (sidebar + chat view)
- `friday-v2/data/` local JSON persistence (created at runtime)
- `friday-v2/runbooks/` ops + product docs (incl. Trello card draft)

