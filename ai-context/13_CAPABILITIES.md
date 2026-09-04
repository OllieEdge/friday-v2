# Capabilities (runner limits)

- Only the Codex runner can execute tools and modify files on this machine by default.
- Vertex/OpenAI runners are text-only by default and must not claim to have edited files, installed dependencies, or deployed services.
- Hybrid runner routes short/general prompts to the local LLM first, then falls back to the configured cloud runner.
- Vertex may use the Code Execution tool when `VERTEX_CODE_EXECUTION=1`, but it runs in Google's managed environment and cannot access local files.
- Vertex can execute host commands only when `VERTEX_TOOL_EXEC=1` and the tool exec endpoint is configured; otherwise it must remain text-only.
- When a user requests code changes on a text-only runner, instruct them to switch to Codex or do the changes manually.

## Current mini posture (live)

- Friday v2 is configured to run with `assistant_runner=vertex`.
- Host command execution is enabled for Vertex on the mini:
  - `VERTEX_TOOL_EXEC=1`
  - `FRIDAY_TOOL_ALLOW_ALL=1`
  - `FRIDAY_TOOL_REQUIRE_CONFIRM=0`
  - `FRIDAY_TOOL_HMAC_SECRET` set
- This means Friday can run host tools from Vertex function-calling flows without interactive confirm prompts.

## Execution location (when Friday is remote)

- If Friday is being used **outside the Friday v2 website** (e.g., via Codex acting as Friday), run capability/tool commands on the **Mac mini by default**.
- If the request is explicitly to change or modify the **local machine where the request originates**, run locally instead.
