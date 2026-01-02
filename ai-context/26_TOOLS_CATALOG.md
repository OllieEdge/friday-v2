# Tools catalog (what Friday can lean on)

## `ai` repo (personal ops + autonomous dev)

`~/workspace/ai` is the operational source of truth:

- runbooks (ssh, sudo, nginx, docker, service docs)
- safe env editing helpers (`tools/env/*`)
- Trello automation CLI (`tools/trello-ai/*`)
- health checks + “repair” workflows

Friday v2 should treat these as canonical references when answering “how do I…?” about home ops.

## `olivers-tools` (“eip-tools”)

`~/workspace/olivers-tools` is a toolbox repo with many AWS Lambda projects and scripts.

- Read-only AWS discovery is fine.
- Any AWS-modifying action requires explicit permission (see `ai-context/80_EIP_TOOLS_AWS.md`).

