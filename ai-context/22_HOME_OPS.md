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
- The preschool router full-tunnel OpenVPN service runs natively on the gateway as root LaunchDaemon `com.ollie.ai.openvpn-gateway`.

## Preschool VPN

- Runbook: `~/workspace/ai/runbooks/services/openvpn-preschool-gateway.md`
- OpenVPN server listener: `TCP 21`
- Tunnel subnet: `10.67.0.0/24`
- `pf` NAT anchor: `/etc/pf.anchors/com.ollie.ai.openvpn-gateway`
- Logs: `/var/log/openvpn-preschool-gateway/`
- Log rotation: `/etc/newsyslog.d/com.ollie.ai.openvpn-gateway.conf` (`1 MB`, `count 1`)
- Router display name in alerts: `Little Pickles Router`
- Router endpoint: `edgflix.com`
- Router watchdog:
  - local DD-WRT script reconnects OpenVPN
  - regenerates the known-good DD-WRT `tcp-client` config because the built-in DD-WRT OpenVPN generator did not reliably emit the working TCP 21 client config
  - trims `/tmp/little-pickles-vpn-watchdog.log` to `1 MB`
  - restarts OpenVPN on low memory
  - reboots only on critically low memory with cooldowns
- Mac mini monitor:
  - LaunchAgent `com.ollie.ai.little-pickles-vpn-monitor`
  - Discord alert after 3 failed checks
  - hourly reminder cap
  - one recovery alert
- Router LAN management is intended over the VPN, not over school WAN:
  - router LAN: `192.168.1.0/24`
  - router admin: `http://192.168.1.1`
  - preferred access path: SSH to the Mac mini, then local port-forward to `192.168.1.1:80`

## Quick verification patterns

- Service is up locally: `curl http://127.0.0.1:<port>/...`
- Public is up: `curl -I https://<subdomain>.edgflix.com/...`
- nginx reload (as automation user): `sudo -n /opt/homebrew/opt/nginx/bin/nginx -t && sudo -n /opt/homebrew/opt/nginx/bin/nginx -s reload`

## SSH access boundary

- Direct WAN SSH is intentionally blocked by the Mac mini host firewall, including the former `jellyfin.edgflix.com:22` route.
- On the home LAN, prefer the SSH alias `doodlebox-mac-mini` or use `ollie@192.168.0.44` with an already-authorized per-machine key.
- Away from home, establish an approved private path to the home LAN first; do not expose SSH or weaken PF as a workaround.
- For complete access, firewall, monitoring, and incident-triage guidance, read `ai-context/23_MAC_MINI_SECURITY.md`.
