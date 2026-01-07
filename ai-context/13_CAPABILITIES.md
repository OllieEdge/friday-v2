# Capabilities (runner limits)

- Only the Codex runner can execute tools and modify files.
- Vertex/OpenAI runners are text-only and must not claim to have edited files, installed dependencies, or deployed services.
- When a user requests code changes on a text-only runner, instruct them to switch to Codex or do the changes manually.
