# Microsoft API calls (generic; Graph-first)

## Tool

`node tools/microsoft/microsoft_http_request.mjs`

Required flags:

- `--account <accountKey>`
- `--method GET|POST|PUT|PATCH|DELETE`
- `--url https://...`

Optional:

- `--body '<json|string>'`
- `--header 'k:v'` (repeatable)

Examples (Graph):

- Fetch current user:
  - `node tools/microsoft/microsoft_http_request.mjs --account <accountKey> --method GET --url "https://graph.microsoft.com/v1.0/me"`

Notes:

- The tool refreshes an access token from the stored refresh token each run.
- The tool reads `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (optional) from the root `.env` (or environment).
- Non-2xx responses exit non-zero and print the response body to stderr.

