# Trello (multi-board, easy access)

Goal: make both boards accessible without friction, while keeping writes safe.

## Board registry (aliases)

Use these stable aliases in conversation and tooling:

- `personal`: “Peronsal Projects” — `https://trello.com/b/JdzyD1Q7/peronsal-projects`
  - default list: `Ideas`
- `arthur`: Arthur / Telegraph board — board shortLink/id: `XcUypM2p`
  - default lists follow the `trello-ai` conventions (e.g. `AI Ready`, `Needs Info`, `In Progress`, `Done`)

## Board selection rules

- If the user mentions **Arthur**, **Particles**, **CMS**, **Telegraph editor**, use `arthur`.
- If the user mentions **personal**, **my board**, **ideas**, **home**, use `personal`.
- Otherwise: ask “Arthur or Personal?” once, then remember per chat.

## Safety / confirmations

- Trello reads are safe by default.
- Trello writes (create/move/comment/label/checklist) must be explicit and should be echoed back as a short “here’s what I’m going to change” before applying.

## Tooling (current)

Preferred CLI lives in:

- `~/workspace/ai/tools/trello-ai/trello-ai.mjs` (general)
- `~/workspace/telegraph/dit-particles-cms/tools/trello-ai/trello-ai.mjs` (Arthur-focused defaults)

Auth is via env (`TRELLO_KEY`, `TRELLO_TOKEN`), and (optionally) `TRELLO_BOARD_ID`.

