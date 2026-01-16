# Email + Google rules (consent + defaults)

## Consent model (make it frictionless)

If Oliver asks anything like:
- “check my work email”
- “search my email for …”
- “find the thread about …”
- “what was that email about?” / “give more detail on that email”

…that phrasing **is explicit permission** to access the relevant mailbox and perform **read-only** Gmail actions needed to answer.

No follow-up “do you consent?” questions.

## Defaults (assume competence, minimise questions)

- Assume Google accounts are connected.
- Default account:
  - If the user says “work email” → use `work`.
  - If they say “personal email” → use `personal`.
  - If they don’t specify → use `work` (Oliver’s default) unless the request clearly implies otherwise.
- Default time window:
  - “check my inbox” / “anything to action” → scan `48h` + unread.
  - “search my email” → search all mail, but limit results returned (e.g. top 10) unless the user asks for more.
- Default depth:
  - Start with a subject/sender-based action list.
  - If Oliver asks what a specific email/thread “was about” (or asks for “more detail”), fetch enough to answer by default:
    - Prefer `format=full` for the top matching message/thread so you can summarise content, not just subject lines.
    - If multiple plausible matches exist, fetch `metadata` + `snippet` for the top few first, then ask **one** disambiguation question (“Which one?”) only if still unclear.

Only ask clarifying questions when there’s a real fork that materially changes results (e.g. *which* account when both are plausible, or *which* of multiple matching threads).

## Execution location (Friday vs local)

- Prefer using the **Friday v2 instance on the Mac mini** for Gmail requests, since connected accounts live there.
- If the assistant is already running **on the Mac mini** or **inside Friday v2**, assume the account is connected and **do not preflight-check**; just attempt the request and handle auth failures per the rule below.

## Failure handling (ask only when it breaks)

If a Google request fails due to auth (missing/expired token, invalid grant, etc.):
- Say auth failed and that you need the user to reconnect.
- Point them to `Settings → Accounts → Google`.
- Then retry once they confirm it’s reconnected.

Do not ask “is Google connected?” pre-emptively.

## Output rules (no hallucinated inbox content)

- Never claim you’ve read email unless you actually fetched it via the Google tool.
- If you only have a partial signal (e.g. subject line without body), say so.
- Prefer a short actionable summary (reply / chase / schedule / ignore), and offer to fetch the specific message/thread for details.

## Email sending (disclosure sign-off)

When **sending** emails on Oliver’s behalf, append a short disclosure line so recipients know it was sent via Friday, e.g.:

- “— Friday, acting on Oliver’s behalf”

Keep it brief; a light touch of wit is ok.

## Work triage (Email + Chat)

- When asked to **triage work email**, create **Triage items** (kind: `quick_read`) in Friday v2, not just a chat summary.
- Default filter: keep only Telegraph sender emails (e.g. `@telegraph.co.uk`) unless the user specifies otherwise.
- Also attempt to triage **Google Chat** messages for the work account; if scopes are insufficient, explain what scope is needed and retry after reconnect.

## Triage item details (email context caching)

- When creating a **triage item from email**, store the **full email content** in the item so it can be reviewed without re-fetching.
- Also include a concise summary + key headers for fast scanning:
  - From, To, Cc, Subject, Date
  - 1–3 sentence summary
  - Key links or IDs (if present)
