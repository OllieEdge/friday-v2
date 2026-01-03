# Google API calls (generic; no Gmail-specific code)

## Principle

Friday v2 should not ship custom server “Gmail actions”. Instead:

- connect Google accounts via OAuth
- then use a single generic tool to call the right Google API endpoints as needed

Codex decides which endpoints/params to use.

## Tool

`node tools/google/google_http_request.mjs`

Required flags:

- `--account work|personal`
- `--method GET|POST|PUT|PATCH|DELETE`
- `--url https://...`

Optional:

- `--body '<json|string>'`
- `--header 'k:v'` (repeatable)

Examples (Gmail):

- Search messages:
  - `node tools/google/google_http_request.mjs --account work --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:1d&maxResults=10"`
- Fetch message metadata:
  - `node tools/google/google_http_request.mjs --account work --method GET --url "https://gmail.googleapis.com/gmail/v1/users/me/messages/<id>?format=metadata"`

Notes:

- The tool refreshes an access token from the stored refresh token each run.
- The tool reads `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the root `.env` (or environment).

