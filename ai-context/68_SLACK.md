# Slack integration (triage + auto-reply)

## Env (Mac mini)

Set in `friday-v2/.env`:

- `SLACK_APP_ID=...`
- `SLACK_CLIENT_ID=...`
- `SLACK_CLIENT_SECRET=...`
- `SLACK_SIGNING_SECRET=...`
- `SLACK_BOT_TOKEN=...`
- Optional: `SLACK_USER_TOKEN=...` (if user-scoped access is required)
- Optional: `SLACK_TARGET_USER_ID=...` (Oliver’s Slack user ID for mention filtering)
- Optional: `SLACK_BOT_USER_ID=...` (avoid replying to self)
- `SLACK_AUTO_REPLY_ENABLED=1`
- `SLACK_AUTO_REPLY_CONFIDENCE=90`

## Event URL

Slack Events should point to:

`https://friday2.edgflix.com/api/slack/events`

## What gets triaged

- DMs to the bot.
- Mentions in channels (app_mention).
- If `SLACK_TARGET_USER_ID` is set, messages containing `<@TARGET>` in channels.

## Auto-reply

If auto-reply is enabled and confidence ≥ threshold, Friday replies using the bot token.
If confidence is lower, the message stays as a triage item only.
