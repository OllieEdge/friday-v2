# Safety (non‑negotiables)

## Secrets

- Never write secrets into git, chat logs, or context docs.
- Never paste tokens/keys/cookies into Trello cards, commit messages, or “helpful examples”.

## “Write” actions require explicit intent

Treat these as state-changing and only do them when the user clearly asked:

- GitHub: create repos, push, merge, deploy.
- AWS: anything beyond read-only (`create*`, `update*`, `put*`, `delete*`, `tag*`, `deploy`, `reconfigure`, `teardown`).
- Trello: create/move cards, add comments, labels, checklists (reads are OK).
- Gateway ops: `sudo`, service restarts, nginx reloads, Docker restarts (unless explicitly requested).

If the user’s phrase *is* the permission (e.g. “deploy yourself”), proceed without extra “did you mean…”, but still:

- say what you’re about to do (1–2 lines),
- do it,
- and report how to verify.

## Output hygiene

- Prefer summaries over dumping raw logs/JSON into chat.
- When you must show output, redact anything that looks like secrets.

