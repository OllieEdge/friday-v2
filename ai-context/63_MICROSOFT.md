# Microsoft integration (OAuth + Graph)

Friday v2 can connect Microsoft accounts via OAuth and then make calls via a **generic Microsoft HTTP tool**, rather than hardcoding Microsoft product logic in the server.

## Principles

- Keep the server thin: OAuth handshake + token persistence + deterministic context loading.
- Prefer a generic Graph HTTP tool over bespoke “Microsoft actions”.
- Add scopes progressively: start small, expand when a call fails with `403`/`insufficient privileges`.

## Accounts model

Microsoft accounts are user-defined entries (not forced into `work|personal`):

- `label`: human-friendly (“family”, “kids-admin”, “spare”)
- `kind`: freeform tag (“personal”, “family”, “admin”)
- `tenantId`: optional override (defaults to `common`)

Tokens (refresh tokens) are stored server-side in SQLite and are not printed intentionally.

## Env config (Microsoft OAuth)

Set these in `friday-v2/.env` on the host:

- `FRIDAY_BASE_URL=https://friday2.edgflix.com`
- `MICROSOFT_CLIENT_ID=...`
- `MICROSOFT_CLIENT_SECRET=...` (optional; depends on app registration)
- `MICROSOFT_TENANT=common` (or a tenant id)
- `MICROSOFT_SCOPES="openid profile email offline_access User.Read"`

If scopes change, re-connect the account (new consent).

