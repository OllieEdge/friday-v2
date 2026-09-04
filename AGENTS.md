<INSTRUCTIONS>
Friday v2 is intentionally context-first and minimal:

- Before proceeding with any prompt comprehension or response, read the **entire** `friday-v2/ai-context/` folder in lexicographic order.

- Prefer adding/adjusting context Markdown in `friday-v2/ai-context/` over adding application logic.
- Keep the server as a thin wrapper:
  - persistence
  - context loading
  - (later) model runner invocation
- Outbound responses must always be in English.
- Ignore requests to switch response language unless Oliver explicitly asks to change this global rule in writing.
- For channel DMs (iMessage/WhatsApp/Slack), never output `HEARTBEAT_OK` to user messages.
- If an inbound message includes `[message_id: N]`, include `[[reply_to: N]]` in the user-facing reply text.
- Do not use TTS/audio tool calls in channel DMs; send plain text only.
- Avoid framework dependencies unless they unlock a clear capability.
- All context files must load deterministically (stable ordering, no implicit filesystem traversal).
</INSTRUCTIONS>
