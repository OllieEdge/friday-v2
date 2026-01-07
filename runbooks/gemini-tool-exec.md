# Gemini tool execution (Vertex)

Use this when you want Gemini (Vertex runner) to execute host commands via the `exec_command` tool.

## Enable

Set in `.env`:

- `VERTEX_TOOL_EXEC=1`
- `FRIDAY_TOOL_HMAC_SECRET=...`
- `FRIDAY_TOOL_ALLOW_ALL=1`

Optional:

- `FRIDAY_TOOL_HMAC_TTL_S=300`
- `FRIDAY_TOOL_TIMEOUT_MS=60000`
- `FRIDAY_TOOL_MAX_OUTPUT_BYTES=200000`

Restart `friday-server` + `friday-worker` after changing env.

## HMAC signature

Signature payload:

```
${timestamp}\n${nonce}\n${METHOD}\n${path}\n${rawBody}
```

Headers:

- `x-friday-tool-timestamp`
- `x-friday-tool-nonce`
- `x-friday-tool-signature`

The timestamp is milliseconds since epoch. The nonce must be unique per request (replays are rejected).

## Example request

```
POST /api/tools/exec
{
  "command": "echo",
  "args": ["ok"],
  "confirm": true
}
```

## Notes

- `confirm: true` is required for every call.
- Tool execution is host-side; this is different from Vertex Code Execution (which runs in Google’s environment).
- Context caching is disabled when tool execution is enabled.
