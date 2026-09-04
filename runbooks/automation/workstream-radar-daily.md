---
accounts:
- work
cursor_strategy: workstream_snapshot_v1
enabled: true
every_minutes: 1440
id: workstream-radar-daily
timezone: Europe/London
title: Workstream radar daily
---

Goal
- Build a daily project radar across coding workstreams (local repos + GitHub notifications when available).

Hard rules
- Discovery only. Do not modify repos, create commits, or write to GitHub.
- Only emit triage items when there is a meaningful coordination signal.

Required command
- Run:
  - `/opt/homebrew/bin/node tools/ops/workstream_snapshot.mjs --json --stale-days 10`

How to use the result
- Read `findings` from the JSON and emit one triage item per finding.
- Preserve each finding's `source_key`, `title`, `summary_md`, `priority`, `confidence_pct`, and `source`.

Priority policy
- Dirty repos and unread GitHub notifications usually map to `next_action`.
- Repo staleness signals usually map to `quick_read` unless there is an urgent blocker.

Cursor
- Set `cursor` to include:
  - `lastTs`
  - `repoCount`
  - `githubAvailable`
  - `githubCount`

If healthy
- If no findings, output `items: []` and update cursor.
