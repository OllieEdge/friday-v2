# Google Gemini via Vertex (runner)

Friday v2 can run Gemini via **Google Vertex AI** (server-side) when the assistant runner is set to `vertex`.

## When to use

- Preferred when you want to use Google/Gemini models instead of OpenAI/Codex.
- This is separate from “Google accounts” (OAuth for Gmail/Calendar/etc).

## How to enable

1) In `.env`, set non-secret config (these are fixed for Ollie):

- `VERTEX_PROJECT_ID=tmg-product-innovation-prod` (default)
- `VERTEX_LOCATION=europe-west2` (default)
- optional: `VERTEX_MODEL=gemini-2.0-flash`

2) Choose ONE auth method:

**A) Service account (recommended for servers)**
- Service account JSON file path: `VERTEX_SERVICE_ACCOUNT_FILE=/path/to/key.json`
- Or AWS Secrets Manager secret containing the service account JSON (recommended for Ollie):
  - `VERTEX_AWS_SECRET_ID=gcp-tmg-product-innovation-prod-all-access`
  - `VERTEX_AWS_REGION=eu-west-1`
  - `VERTEX_AWS_PROFILE=telegraph`
- Direct access token (debug only): `VERTEX_ACCESS_TOKEN=...`

**B) Google OAuth (recommended for interactive use)**
- Configure Google OAuth in `.env`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- In the UI: Settings → Accounts → Google → connect `work` (or `personal`)
- Then in the UI: Settings → Accounts → Assistant runner → Google (Vertex) → Auth → “Google OAuth”
  - Use “Enable Vertex” to re-consent with the required scope: `https://www.googleapis.com/auth/cloud-platform`

3) In the UI: Settings → Accounts → Assistant runner → “Google (Gemini via Vertex)”.

## Env override vs UI

- If `.env` sets `FRIDAY_RUNNER=vertex`, the UI runner selector is ignored.
- If `.env` sets `FRIDAY_RUNNER=settings`, the UI controls which runner is used.

## Context caching (optional)

Vertex is stateless by default; Friday v2 normally sends the full context bundle on every request. To cache the
context bundle on the Vertex side and reduce repeated prompt tokens:

- `VERTEX_CONTEXT_CACHE=1`
- optional: `VERTEX_CONTEXT_CACHE_TTL_S=3600` (min 60, max 86400)

## Operational notes

- Uses Vertex `:generateContent` and runs inside `friday-server`/`friday-worker`.
- Token usage is best-effort and may not match billing exactly.
- Model dropdown is populated by probing known Gemini model IDs via `generateContent`; it requires Vertex auth to be configured.
