<INSTRUCTIONS>
Friday v2 is intentionally context-first and minimal:

- Prefer adding/adjusting context Markdown in `friday-v2/ai-context/` over adding application logic.
- Keep the server as a thin wrapper:
  - persistence
  - context loading
  - (later) model runner invocation
- Avoid framework dependencies unless they unlock a clear capability.
- All context files must load deterministically (stable ordering, no implicit filesystem traversal).
</INSTRUCTIONS>

