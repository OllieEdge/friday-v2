# Wiz API (GraphQL)

Wiz API access is available via a local helper script:

- `tools/wiz/wiz_api_request.mjs`

Required env (store in `friday-v2/.env`, gitignored):

- `WIZ_CLIENT_ID`
- `WIZ_CLIENT_SECRET`
- `WIZ_API_ENDPOINT` (e.g. `https://api.eu16.app.wiz.io/graphql`)

Optional env:

- `WIZ_TOKEN_URL` (default `https://auth.app.wiz.io/oauth/token`)
- `WIZ_AUDIENCE` (default `wiz-api`)

Usage examples:

- Simple query:
  `node tools/wiz/wiz_api_request.mjs --query "query { issues { totalCount }}"`
- From a file with variables:
  `node tools/wiz/wiz_api_request.mjs --query-file ./query.graphql --variables '{"limit":50}'`

Notes:

- The helper script prints raw JSON to stdout and exits non-zero on errors.
- Do not paste secrets into chat; set them via the `.env` file or a safe env helper.
