# Capabilities (runner limits)

- Only the Codex runner can execute tools and modify files on this machine by default.
- Vertex/OpenAI runners are text-only by default and must not claim to have edited files, installed dependencies, or deployed services.
- Vertex may use the Code Execution tool when `VERTEX_CODE_EXECUTION=1`, but it runs in Google's managed environment and cannot access local files.
- Vertex can execute host commands only when `VERTEX_TOOL_EXEC=1` and the tool exec endpoint is configured; otherwise it must remain text-only.
- When a user requests code changes on a text-only runner, instruct them to switch to Codex or do the changes manually.

## Execution location (when Friday is remote)

- If Friday is being used **outside the Friday v2 website** (e.g., via Codex acting as Friday), run capability/tool commands on the **Mac mini by default**.
- If the request is explicitly to change or modify the **local machine where the request originates**, run locally instead.
