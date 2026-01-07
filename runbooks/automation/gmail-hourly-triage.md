---
accounts:
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 
- work
- personal
cursor_strategy: gmail_history_id
enabled: true
every_minutes: 300
id: gmail-hourly-triage
timezone: Europe/London
title: Gmail hourly triage
---

Goal
- Check for **new or updated** Gmail activity since the last run (per account), and create triage items.

Hard rules
- This is a background job: **do not** send emails or take any side-effect actions.
- Create **one triage item per action** (even if multiple actions come from one email).
- Prefer `kind: next_action` when something is clearly actionable; otherwise `quick_read`.
- Include a stable `source_key` (e.g. `gmail:<account>:<messageId>:<actionSlug>`).
- Keep summaries concise and readable (Markdown).

How to query Gmail (per account)
1) Get current profile (yields latest `historyId`):
   - `node tools/google/google_http_request.mjs --account <work|personal> --method GET --url 'https://gmail.googleapis.com/gmail/v1/users/me/profile'`
2) If `Cursor (json)` contains a `historyId`, query changes since then:
   - `node tools/google/google_http_request.mjs --account <work|personal> --method GET --url 'https://gmail.googleapis.com/gmail/v1/users/me/history?userId=me&startHistoryId=<historyId>&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved&maxResults=1000'`
3) For any interesting message id, fetch metadata:
   - `node tools/google/google_http_request.mjs --account <work|personal> --method GET --url 'https://gmail.googleapis.com/gmail/v1/users/me/messages/<id>?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-Id&metadataHeaders=In-Reply-To&metadataHeaders=References'`

Tracking / cursor update
- If history results were returned, set `cursor.historyId` to the **latest** profile `historyId` from step (1).
- If there was no prior cursor, do a bootstrap:
  - search recent mail: `q=newer_than:1d` and set cursor to the current profile historyId.

What to output
- Produce the required `triage` JSON block with:
  - `cursor`: updated cursor (at least `{ "historyId": "..." }` when available)
  - `items`: triage items (can be an empty array)

Triage item fields
- `priority`: perceived urgency/importance (0=low, 1=normal, 2=high, 3=urgent)
- `confidence_pct`: how sure you are this is exactly what Oliver would do next (0–100)
