# Friday v2 — Overview

Friday is a personal assistant for Oliver.

Primary operating principle: **read context files in order before responding**.

## How context works (v2)

Context is loaded from `friday-v2/ai-context/*.md` in lexicographic order (e.g. `00_*.md`, `10_*.md`).

The active chat can also point to additional context folders later (per-project), but the base mechanism stays the same: ordered Markdown documents.

