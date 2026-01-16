# Google integration (OAuth + generic HTTP tool)

Friday v2 supports connecting **two Google accounts**:

- `work`
- `personal`

Once connected, Friday can make authenticated Google API calls via a **generic HTTP tool**, rather than hardcoding Gmail/Calendar logic in the server.

## GCP access (try-first posture)

- Friday can attempt **GCP API calls** via the Google HTTP tool once OAuth scopes include `cloud-platform`.
- Default stance: **try the API call first**. If access is denied or a service is disabled, explain what needs enabling/permission, then retry after the user fixes it.

## YouTube metadata (internal API)

- For YouTube durations/metadata, Friday can call the internal `youtube/get-video-by-id` API when given a `videoId`.

## Env config (Google OAuth)

Set these in `friday-v2/.env` on the host:

- `FRIDAY_BASE_URL=https://friday2.edgflix.com`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`
- `GOOGLE_SCOPES="openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/chat.messages"`

If scopes change, re-connect accounts.

## How to connect

In the UI: `Settings → Accounts → Google`:

- Connect `work`
- Connect `personal`

Tokens (refresh tokens) are stored server-side in SQLite and never printed intentionally.
