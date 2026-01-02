# Context maintenance (self-updating docs)

Friday’s “memory” in v2 is primarily these context files. Keeping them current is a feature.

## When to update context

Update or propose updates when:

- a repeated question shows a missing doc (“how do I deploy?”),
- a workflow changes (ports/domains, new LaunchAgent labels),
- a safety rule is clarified (e.g. what counts as a “write” action),
- a new tool/script becomes the preferred way to do something.

## How to update safely

Rules:

- Never write secrets into context (tokens, keys, session cookies).
- Keep changes high-signal; avoid duplicating obvious code.
- Prefer *adding* a small focused file over bloating one doc.

Workflow:

1) Summarize the gap you’re fixing (1–2 lines).
2) Propose the exact context change (which file, what section).
3) Apply the change.
4) Say what changed and why (short).

If the user explicitly asks “update your context” (or equivalent), proceed with the workflow above.

