# Stack-wide deterministic flows (Friday)

Purpose: make home-ops handling predictable when requests are casual, short, or incomplete.

## Default execution model

- Run on Mac mini by default.
- Prefer `ai` CLI commands first; they already encode routing + safety.
- Use read-only checks first unless user intent includes fix words (`fix`, `recover`, `restart`, `repair`, `sort it`, `make it work`).
- Always run diagnosis and return a short evidence summary before any write action.
- After any repair action, re-run the same health check and return before/after.

## Shared response contract

Every ops response should include:

1) Diagnosis: one line.
2) Evidence: key checks + failing condition.
3) Actions: what was run (or skipped).
4) Status: `healthy`, `degraded`, or `still failing`.
5) Next action: single best follow-up.

## Flow 1: "Check the stack" / "What is broken?"

Triggers:
- `check stack`, `infra status`, `what's down`, `health check`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- watch:infra --skip-jellyfin`
2) If `ok=false` and user asked to fix, run:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- watch:infra --skip-jellyfin --repair`
3) Return structured summary with affected domains.

## Flow 2: "Sonarr didn't download <show>"

Triggers:
- `sonarr`, `hasn't downloaded`, `missing episode`, `not grabbing`

Diagnose ladder:
1) Diagnose:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- sonarr:diagnose --title "<show>"`
2) Return diagnosis summary (match id, monitored state, missing monitored episodes, queue reasons, health warnings).

Fix action (only if requested):
- `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- sonarr:search --series-id <id> --yes`

## Flow 3: "Radarr didn't download <movie>"

Triggers:
- `radarr`, `movie not downloading`, `can't find release`

Diagnose ladder mirrors Sonarr:
1) Diagnose:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- radarr:diagnose --title "<movie>"`
2) Return diagnosis summary (match id, monitored/file state, queue reasons, health warnings).

Fix action (only if requested):
- `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- radarr:search --movie-id <id> --yes`

## Flow 4: "qBittorrent/SAB/NZB is broken"

Triggers:
- `qbittorrent down`, `sabnzbd down`, `download client failed`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:check-services`
2) If the service fails and user asked to fix:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:restart`
3) Re-check:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:check-services`

## Flow 5: "Playlist/EPG is broken"

Triggers:
- `xtream broken`, `playlist failed`, `epg empty`, `guide wrong`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- m3u:xtream-edgflix:diagnose`
2) If stream quality/reachability unclear:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- m3u:xtream-edgflix:stream-check`
3) Validate Channels guide quality:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- channels:guide:placeholder-check`
4) If user asked to fix:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- watch:infra --repair`

## Flow 6: "Channels DVR not updating"

Triggers:
- `channels dvr`, `channels guide missing`, `channels source`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- channels:status`
2) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- channels:list-m3u-sources`
3) For source refresh:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- channels:m3u-source:refresh --id XtreamSportsJellyfin`
4) Validate guide placeholders:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- channels:guide:placeholder-check`

## Flow 7: "Jellyfin live TV/guide failing"

Triggers:
- `jellyfin guide`, `livetv broken`, `jellyfin channels`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- jellyfin:status`
2) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- jellyfin:livetv:programs-health`
3) If user asked to fix:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- jellyfin:livetv:sync-xmltv`
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- jellyfin:livetv:refresh-guide`
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- jellyfin:daemon:restart --yes`

## Flow 8: "Zigbee infra checks failing"

Triggers:
- `zigbee failing`, `zigbee down`, `devices not responding`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:status`
2) If unhealthy and user asked to fix:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:restart`
3) If `fault_recent=true` and `port_8080_listening=false`:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- zigbee:power-cycle`
4) Re-check with `zigbee:status`.

## Flow 9: "Site <domain>.edgflix.com is down"

Triggers:
- `site down`, `502`, `bad gateway`, `domain not loading`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- nginx:status`
2) If domain maps to dockerized upstream, run:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:check-services`
3) If user asked to fix:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- nginx:restart`
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:restart` (only when upstream is docker-backed)
4) Re-test public URL with `curl -I https://<domain>`.

## Flow 10: "Edgflix Live is not working"

Triggers:
- `live stream down`, `live-test broken`, `rtmp not working`

Steps:
1) Check SRS/API ports via infra:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- docker:check-services`
2) Verify web process:
   - `launchctl print gui/$(id -u)/com.edgflix.live-web`
   - `launchctl print gui/$(id -u)/com.edgflix.live-web-test`
3) If user asked to fix:
   - restart SRS compose in target checkout
   - kickstart corresponding LaunchAgent
4) Re-test `https://live.edgflix.com` or `https://live-test.edgflix.com`.

## Flow 11: "Code server (code.edgflix.com) down"

Triggers:
- `code.edgflix.com 502`, `codeserver down`, `tunnel down`

Steps:
1) Check tunnel/listeners (`10080`, `10443`) on Mac mini.
2) If requested, restart tunnel server LaunchAgent:
   - `launchctl kickstart -k gui/$(id -u)/com.edgflix.codex-chisel`
3) If still down, report "client tunnel likely disconnected" and request client-side restart.

## Flow 12: "iOS/TestFlight build pipeline failing"

Triggers:
- `testflight broken`, `ios build failed`, `upload failed`

Steps:
1) `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- ios:testflight:doctor`
2) If diagnosis says keychain/signing issue, use keychain runbook flow.
3) If requested, run build/upload:
   - `cd /Users/ollie/workspace/ai && /opt/homebrew/bin/npm run ai -- ios:testflight:build-upload --project <...> --scheme <...> --yes`

## Deterministic disambiguation rules

- If request names a service, run that service flow directly.
- If request mentions a user symptom only ("not downloading", "site down"), run Flow 1 first, then branch to the most likely service flow.
- Ask one clarifying question only when two flows are equally likely.

## Friday API endpoints for these flows

- `GET /api/ops/flows`
  - Returns typed flow registry + validation state.
- `POST /api/ops/resolve-intent`
  - Inputs: `{ text, inputs?, fixIntent? }`
  - Returns best matched flow + deterministic diagnose/repair/verify plan and missing inputs.
- `POST /api/ops/resolve-intent/execute`
  - Inputs: `{ text, inputs?, fixIntent?, runRepair?, runVerify?, timeoutMs? }`
  - Runs deterministic steps and returns the shared 5-part contract:
    - diagnosis
    - evidence
    - actions
    - status
    - next action
