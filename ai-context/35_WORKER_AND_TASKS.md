# Worker + Durable Tasks (restart-safe execution)

Friday v2 must be able to “work on herself” (deploy/restart) without killing in-flight assistant runs.

If the runner executes inside the same process as the web server, any restart takes out the runner mid-flight. That’s funny exactly once.

## Architecture (same repo, separate process)

- `friday-server` (UI/API): thin wrapper for auth, persistence (SQLite), deterministic context loading, and job orchestration.
- `friday-worker` (runner): polls durable tasks from SQLite, executes them, persists results/events back to SQLite.

The UI reconnects by `taskId` after any server restart.

## Durable task model

- Tasks live in SQLite (`tasks`, `task_events`).
- The server creates tasks (e.g. chat runs) and returns a `taskId`.
- The worker claims `queued` tasks, runs them, and appends:
  - status events (`loading_context`, `running`)
  - runner/tool events (e.g. Codex JSON events)
  - final `assistant_message`
  - terminal `done` event

The server’s SSE endpoint (`GET /api/tasks/:taskId/events`) streams by polling `task_events`, so it works even after a server restart.

## Operational rule (non-negotiable)

Long-running work must happen in the worker, not inside the server process.

If you’re adding a new integration (e.g. Microsoft), start by:
- creating a `task` with input JSON
- having the worker execute it
- persisting results + events

## Local dev (two terminals)

- Server: `npm -w server run dev`
- Worker: `npm -w server run dev:worker`

## Verification: kill-server test

1) Start a chat run that takes ~15–60s (e.g. a tool call that sleeps).
2) Restart only the server while it’s `running`.
3) Confirm:
   - the task continues and completes
   - the assistant message content updates in the chat
   - `/api/tasks/:taskId` still exists and ends `ok`/`error`
