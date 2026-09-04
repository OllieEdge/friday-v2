---
accounts:
- work
cursor_strategy: ops_snapshot_v1
enabled: true
every_minutes: 60
id: ops-control-tower-hourly
timezone: Europe/London
title: Ops control tower hourly
---

Goal
- Keep Friday's operational backlog healthy by detecting stale triage, failing runbooks, and pending message-driven actions.

Hard rules
- Discovery only. Do not execute side-effect actions.
- Produce actionable triage items only when there is a real issue.
- Use stable `source_key` values from the snapshot output to avoid duplicates.

Required command
- Run:
  - `/opt/homebrew/bin/node tools/ops/control_tower_snapshot.mjs --json --stale-hours 24 --pending-limit 40`

How to use the result
- Parse `summary` and `findings` from the JSON.
- For each entry in `findings`, output one triage item with the same:
  - `kind`
  - `priority`
  - `confidence_pct`
  - `title`
  - `summary_md`
  - `source_key`
  - `source`
- Output limit:
  - Include at most 8 findings in `items` (highest priority first).
  - If additional findings exist, include one final `quick_read` rollup item noting the omitted count.

Cursor
- Set `cursor` to:
  - `lastTs`: snapshot timestamp
  - `staleHours`: 24
  - `pendingActions`: count from summary

If healthy
- If `findings` is empty, output `items: []` and still update cursor.
