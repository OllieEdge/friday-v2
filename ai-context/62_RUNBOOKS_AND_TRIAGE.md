## Runbooks + Triage (Friday v2)

Friday v2 supports **scheduled runbooks** (cron-like) and a **Triage** UI.

### Runbooks (scheduled background jobs)

- Location: `runbooks/automation/*.md`
- A runbook is a Markdown file with a small YAML frontmatter header for scheduling.
- The scheduler runs inside the Friday server and executes runbooks using the normal runner + context, but the chat is **hidden**.
- Background runbooks must be **read/discovery only** (no side effects).

Minimal header fields (recommended)

```md
---
id: gmail-hourly-triage
title: Gmail hourly triage
enabled: true
every_minutes: 60
accounts:
  - work
  - personal
timezone: Europe/London
cursor_strategy: gmail_history_id
---
```

Notes
- `every_minutes` is the only schedule supported right now.
- Cursors (e.g. Gmail `historyId`) are stored in SQLite per-runbook per-account to avoid reprocessing.

Creating a runbook via chat
- You can create a new runbook by writing a new Markdown file under `runbooks/automation/`.
- The scheduler discovers it automatically.

### Triage items

- The Triage page shows three lists:
  - Quick reads (`kind=quick_read`, `status=open`)
  - Next actions (`kind=next_action`, `status=open`)
  - Completed (`status=completed`)
- Rule: **one triage item per action** (digestible).
- Each triage item has a **hidden backing chat** that uses the same context and runner.
- Triage item chats can be promoted into the normal chat sidebar.
- Each triage item also carries:
  - `priority` (0=low, 1=normal, 2=high, 3=urgent)
  - `confidence_pct` (0–100): how sure the assistant is this matches what Oliver would do

### Actioning patterns (Oliver)

- Dismiss items that are clearly outside Oliver’s remit.
- For in‑progress work that is top priority, keep the item open and bump priority to urgent.
- For email threads: reply only to the necessary recipients (not always reply‑all).
- If Oliver plans to handle something manually, mark the item completed after confirming intent.

### Topic relevance (triage heuristics)

Keep topics short (1–2 words). Categorize by likelihood Oliver should be involved.

PROBABLE:
- YouTube
- Particles
- Regwall
- Paywall
- WAF
- XSS

UNKNOWN:
- Live blog
- Newsletter

IMPROBABLE:
- LinkedIn

Updating triage status
- Users can change status in the UI.
- The assistant can also update status by running:
  - `node tools/triage/triage.mjs set-status --id <triageItemId> --status completed`

Feedback (learning loop)
- When a user dismisses/completes/reopens an item, Friday records feedback (reason/outcome/notes).
- Runbooks receive a compact summary of recent feedback to improve prioritisation and confidence over time.

### Safety / confirmation

- Runbooks must not take side-effect actions.
- For actions, first propose and wait for explicit user confirmation (e.g. user replies `CONFIRM`) before proceeding.
