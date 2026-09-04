# Intent routing: home media + Zigbee ops

When requests are phrased casually (for example, "why hasn't X downloaded on Sonarr?" or "the Zigbee infra checks are failing"), route to deterministic runbook steps on the Mac mini.

## Execution defaults

- Run these checks on the Mac mini by default.
- Read-only diagnostics first.
- Always return a diagnosis summary before any write action.
- For write actions (restart/reconfigure/search trigger), the user's request to "fix" counts as explicit permission after diagnosis.

## Intent: "Why hasn't <show> downloaded on Sonarr?"

Use this flow before asking follow-up questions:

1) Run deterministic diagnosis:
- `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- sonarr:diagnose --title "<show>"`

2) Reply with diagnosis and concrete fix options.
- Always include:
  - root cause (or top 2 likely causes),
  - exact evidence (queue/history snippet summary),
  - safest next action.

Common write action (only when requested to fix):
- Trigger search: `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- sonarr:search --series-id <id> --yes`

## Intent: "Zigbee infra checks are failing, please fix"

Use this flow:

1) Run health check:
- `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- watch:infra --skip-jellyfin`

2) If Zigbee is unhealthy, inspect:
- `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:status`

3) Auto-repair ladder:
- Restart bridge:
  - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:restart`
- If `fault_recent=true` and `port_8080_listening=false`, power-cycle:
  - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:power-cycle`

4) Re-run health check and report final state.

## Intent: "Check the Mac mini for malicious activity"

Triggers include `anything malicious`, `security alerts`, `SSH attempts`, `who accessed the Mac mini`, `was the Mac breached`, and requests to check a recent time window.

1) Read and follow `ai-context/23_MAC_MINI_SECURITY.md`.
2) Run its read-only recent-activity triage for the requested time window.
3) Correlate PF-denied probes, established connections, authentication/process evidence, persistence changes, and monitor conditions.
4) State the evidence level explicitly: `blocked probe`, `connection only`, `suspicious change`, or `confirmed access`.
5) Do not remediate, rebuild the baseline, or change the DMZ/firewall unless Oliver explicitly asks.

## Response format for these intents

- One-line diagnosis.
- Evidence bullets (what was checked, key failing condition).
- Actions taken.
- Current status (`healthy`, `degraded`, or `still failing`).
