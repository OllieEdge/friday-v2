# Deployment (Friday v2)

## What “deploy Friday” / “deploy yourself” means

Deploy the current Friday v2 repo to the canonical v2 environment:

- public URL: `https://friday2.edgflix.com`
- host: Mac mini (gateway)

## Current runtime (high-signal)

- Process manager: macOS LaunchAgent `com.friday.v2`
- Local port: `3334`
- Reverse proxy: nginx on the Mac mini proxies `friday2.edgflix.com` → `http://127.0.0.1:3334`

## Standard deploy steps (conceptual)

1) Ensure local changes are committed + pushed to GitHub.
2) On the Mac mini: pull latest in `/Users/ollie/workspace/friday-v2`.
3) Install deps + build UI:
   - `cd /Users/ollie/workspace/friday-v2 && npm install && npm run build`
4) Restart the LaunchAgent.
5) Verify `GET https://friday2.edgflix.com/api/health` returns `{ "ok": true }`.

If nginx config changed, reload nginx (as the automation sudo user).

## Runner config (quick)

Friday v2 can run in a few modes depending on `.env`:

- Seat-based (preferred): `FRIDAY_RUNNER=codex` (requires Codex CLI device login in Settings → Accounts).
- Metered fallback: `FRIDAY_RUNNER=openai` + `OPENAI_API_KEY=...` (uses the OpenAI API; pay-per-use).
