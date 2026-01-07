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

## Output length (optional)

Vertex output is limited by `maxOutputTokens`. By default Friday v2 uses 1024 output tokens; to allow longer responses:

- `VERTEX_MAX_OUTPUT_TOKENS=8192` (max 65536, model permitting)

## Code execution (optional)

Gemini can run code via Vertex’s Code Execution tool. To enable it:

- `VERTEX_CODE_EXECUTION=1`

This executes in Google’s managed environment (no access to this machine’s filesystem).
When code execution is enabled, context caching is disabled for Vertex to avoid API conflicts.

## Tool execution on host (optional)

Gemini can call a host-exec tool (function calling) when explicitly enabled:

- `VERTEX_TOOL_EXEC=1`
- `FRIDAY_TOOL_HMAC_SECRET=...` (HMAC secret for `/api/tools/exec`)
- `FRIDAY_TOOL_ALLOW_ALL=1` (allow any command; `confirm=true` still required per call)

Tool calls are executed on the Friday host and are still subject to explicit confirmation in the request payload.
When tool execution is enabled, context caching is disabled for Vertex to avoid API conflicts.

## Operational notes

- Uses Vertex `:generateContent` and runs inside `friday-server`/`friday-worker`.
- Token usage is best-effort and may not match billing exactly.
- Model dropdown is populated by probing known Gemini model IDs via `generateContent`; it requires Vertex auth to be configured.
