# Trello card draft — Friday v2 (context-first)

## Why
Friday v1 taught us that complex “AI server logic” becomes brittle and tightly coupled to a model. Friday v2 shifts value into:
- deterministic context documents,
- isolated scripts/tools,
- a minimal UI/API wrapper that can swap models/runners over time.

## MVP scope
- Web UI:
  - left sidebar: chat list (create/select)
  - main panel: current chat
  - show “Loaded context” (collapsible) for transparency/debugging
- API:
  - list/create chats
  - list/append messages
  - load context bundle (ordered Markdown)
- No AI business logic on the server.

## Model runner (next)
- Chat send triggers a runner (initially Codex CLI) with:
  - system prompt
  - concatenated context docs
  - chat transcript
- Runner produces assistant output, persisted as a message.

## Tooling (later)
- “Tools” are isolated shell/node scripts exposed via context docs:
  - Gmail query script
  - Action processing script(s)
  - Slack/WhatsApp integrations
- Accounts area to connect third parties (Google/Slack/WhatsApp/AWS etc) and surface auth status to the assistant.

## Non-goals (MVP)
- Complex background jobs
- Automatic comms triage
- Custom inference server

## Acceptance criteria (MVP)
- Start server and open UI locally.
- Create/select chats; messages persist across reload.
- Context files load deterministically and are visible to the user.

