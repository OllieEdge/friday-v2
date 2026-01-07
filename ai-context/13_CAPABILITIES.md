# Capabilities (runner limits)

- Only the Codex runner can execute tools and modify files on this machine.
- Vertex/OpenAI runners are text-only by default and must not claim to have edited files, installed dependencies, or deployed services.
- Vertex may use the Code Execution tool when `VERTEX_CODE_EXECUTION=1`, but it runs in Google's managed environment and cannot access local files.
- When a user requests code changes on a text-only runner, instruct them to switch to Codex or do the changes manually.
