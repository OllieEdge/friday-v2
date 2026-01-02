# Home ops (Mac mini gateway)

## Machine + routing

- Mac mini host: `doodlebox-mac-mini` (LAN `192.168.0.44`, WAN `edgflix.com`).
- Prefer LAN when reachable; fall back to WAN when away.
- Non-interactive shells may have a minimal PATH; prefer full binary paths:
  - Node: `/opt/homebrew/bin/node`
  - nginx: `/opt/homebrew/opt/nginx/bin/nginx`

## Sudo for automation users

For privileged gateway ops, prefer dedicated automation users:

- `codex@192.168.0.44` (passwordless `sudo -n ...`)
- `friday@192.168.0.44` (passwordless `sudo -n ...`)

This avoids depending on `ollie` having an interactive sudo prompt.

## Common service shape

- nginx terminates TLS on the gateway and reverse-proxies to local ports.
- Many home services run via Docker Desktop on the gateway.
- User-level apps (Friday v1/v2) run via `launchd` LaunchAgents.

## Quick verification patterns

- Service is up locally: `curl http://127.0.0.1:<port>/...`
- Public is up: `curl -I https://<subdomain>.edgflix.com/...`
- nginx reload (as automation user): `sudo -n /opt/homebrew/opt/nginx/bin/nginx -t && sudo -n /opt/homebrew/opt/nginx/bin/nginx -s reload`

