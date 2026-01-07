# Tools catalog (what Friday can lean on)

## `ai` repo (personal ops + autonomous dev)

`~/workspace/ai` is the operational source of truth:

- runbooks (ssh, sudo, nginx, docker, service docs)
- safe env editing helpers (`tools/env/*`)
- Trello automation CLI (`tools/trello-ai/*`)
- health checks + “repair” workflows

Friday v2 should treat these as canonical references when answering “how do I…?” about home ops.

## Friday v2 local tools

- Google HTTP wrapper: `tools/google/google_http_request.mjs` (refresh-token based, per `work|personal`)
- Microsoft HTTP wrapper: `tools/microsoft/microsoft_http_request.mjs` (refresh-token based, per connected `accountKey`)
- Triage helper: `tools/triage/triage.mjs`
  - list triage items
  - set status / set priority
  - record/list feedback events (dismiss/completed/notes)

## `olivers-tools` (“eip-tools”)

`~/workspace/olivers-tools` is a toolbox repo with many AWS Lambda projects and scripts.

- Read-only AWS discovery is fine.
- Any AWS-modifying action requires explicit permission (see `ai-context/80_EIP_TOOLS_AWS.md`).
