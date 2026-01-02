# Workspace map (what exists and why)

Your workspace is a **set of separate repos** under `~/workspace` (not one monorepo), plus the Telegraph “telegraph workspace” folder which itself contains multiple git repos.

## Key repos (high level)

- `~/workspace/friday-v2` — Friday v2 (context-first, minimal UI + API wrapper).
- `~/workspace/friday` — Friday v1 (voice/web ops assistant; heavier architecture).
- `~/workspace/ai` — personal ops + autonomous dev tooling + runbooks (Mac mini operations, health checks, Trello tooling, env helpers).
- `~/workspace/olivers-tools` — “eip-tools” toolbox repo (many Lambdas/tools; AWS safety rules apply).

## Telegraph workspace (multi-repo folder)

`~/workspace/telegraph` contains multiple *separate* git repos side-by-side, commonly including:

- `dit-particles-cms` — Arthur CMS (Particles editor).
- `particles-api` — Particle API service.
- `eip-socket-api` — Yjs collaboration + trace stream.
- `trace-dashboard` — UI for trace stream.

Friday v2 should be “aware” of these projects (what they are, how to work safely), but v2 should not embed their detailed implementation logic.

