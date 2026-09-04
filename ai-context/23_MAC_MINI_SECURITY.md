# Mac mini security operations

Use this reference when Oliver asks about Mac mini access, exposure, suspicious activity, security alerts, SSH attempts, the host firewall, or what happened in a recent time window.

## Scope and safety

- Host: `doodlebox-mac-mini`, LAN address `192.168.0.44`.
- The router DMZ is intentionally enabled. Do not disable or alter it unless Oliver explicitly asks.
- Internet exposure is constrained on the Mac by `pf`; do not infer exposure from a process listening on `*` alone.
- Start incident/security requests with read-only checks. Do not reload `pf`, restart services, change access, rebuild the monitor baseline, or remediate findings unless Oliver asks to make changes.
- Never put passwords, private keys, recovery keys, webhook URLs, health tokens, or credential values in context, commands shown to the user, or summaries.

## Access

- When already on the Mac mini, run commands locally.
- From the home LAN, prefer the SSH alias `doodlebox-mac-mini`; the explicit fallback is `ollie@192.168.0.44` with an already-authorized per-machine key.
- Direct public/WAN SSH is intentionally blocked by the host firewall. Do not use the former `jellyfin.edgflix.com:22` route or weaken PF to regain it.
- When away from home, first use an approved private path that reaches the home LAN, then SSH to the LAN address. If no private path is currently available, report that limitation rather than exposing SSH publicly.
- For privileged read-only checks, prefer a configured automation account with `sudo -n`. If it is unavailable, use the approved credential store/workflow without printing the credential. Never assume a password or embed one in documentation.
- SSH policy is key-only: root login, password authentication, and keyboard-interactive authentication are disabled. Expected allowed accounts are `ollie`, `codex`, and `friday`.

## Intentional public services and PF

The host firewall files are:

- main ruleset: `/etc/pf.conf`
- host hardening anchor: `/etc/pf.anchors/com.ollie.ai.incident-hardening`
- preschool VPN/NAT anchor: `/etc/pf.anchors/com.ollie.ai.openvpn-gateway`

The intended inbound policy on `en0` is:

- TCP 21: OpenVPN for Little Pickles Router
- TCP 80 and 443: nginx public web services
- TCP 22: allowed only from `192.168.0.0/24`; public IPv4 and all IPv6 SSH are denied and logged
- TCP/UDP 53, 88, and 445: denied by host hardening
- other unsolicited public IPv4 and IPv6 traffic: denied

Validate the loaded rules, not just the files:

```sh
sudo -n /sbin/pfctl -s info
sudo -n /sbin/pfctl -a com.ollie.ai/incident-hardening -sr
sudo -n /sbin/pfctl -a com.ollie.ai/openvpn-gateway -sn
```

The hardening anchor must contain loaded `block drop` rules and explicit passes for 21, 80, and 443. A present anchor file with an empty `pfctl -a ... -sr` result means the rules are not active. macOS upgrades can replace `/etc/pf.conf`; the security monitor should report this as `file_integrity` and `security_posture`/`packet_filter`.

## Security monitor

- LaunchDaemon: `com.edgflix.security-monitor`
- program: `/usr/local/libexec/edgflix-security-monitor.py --run`
- config: `/Library/Application Support/Edgflix Security Monitor/config.json` (sensitive; do not print it)
- event log: `/var/log/edgflix-security-monitor/events.jsonl`
- state: `/var/db/edgflix-security-monitor/state.json`
- approved baseline: `/var/db/edgflix-security-monitor/baseline.json` (normally protected with the `schg` immutable flag)
- PF SSH capture LaunchDaemon: `com.edgflix.ssh-pf-log`
- blocked SSH packet log: `/var/log/edgflix-security-monitor/ssh.log` (rotates at 5 MB, keeping five old files)
- capture errors: `/var/log/edgflix-security-monitor/ssh-capture.err.log`

The monitor checks known indicators of compromise, persistence locations, protected-file integrity, new non-loopback listeners, CPU/load anomalies, temporary executables, host security posture, live SSH sources, and blocked public SSH attempts. Discord is reserved for actionable critical conditions; informational events, blocked probes, routine summaries, and recoveries remain in local logs. Equivalent critical alerts are deduplicated for six hours.

Quick read-only health check:

```sh
sudo -n /bin/launchctl print system/com.edgflix.security-monitor
sudo -n /bin/launchctl print system/com.edgflix.ssh-pf-log
sudo -n /usr/bin/tail -n 100 /var/log/edgflix-security-monitor/events.jsonl
sudo -n /usr/bin/tail -n 100 /var/log/edgflix-security-monitor/ssh.log
sudo -n /usr/bin/python3 -c 'import json; s=json.load(open("/var/db/edgflix-security-monitor/state.json")); print([k for k,v in s.get("conditions",{}).items() if v.get("active")])'
```

Do not run `--build-baseline` during diagnosis. It accepts the current filesystem/listener state and can hide an uninvestigated change. Rebuild it only after every difference has been explained and Oliver has asked to accept the new state; preserve a backup and restore the `schg` flag afterward.

## Correctly interpreting SSH evidence

- A line in `ssh.log` is a PF-logged TCP SYN that the firewall denied. It is evidence of an attempted connection, not a login or compromise.
- `ssh_new_source` is derived from an established TCP connection. It identifies a network source but, by itself, does not prove authentication succeeded.
- Repeated retransmissions from the same source/port are usually one connection attempt, not separate successful attempts.
- An `sshd` or `sshd-auth` process owned by `_sshd` is normally a pre-authentication process. It is not evidence of a user shell.
- Treat a successful login as established only with corroboration such as an authenticated user-owned `sshd` session, a user process/session tied to the connection, or another authoritative authentication record.
- macOS unified logging on this host has not reliably exposed OpenSSH `Accepted publickey`/failure text. Do not claim it did when only TCP/process evidence is available.

## Recent malicious-activity triage

For “anything malicious in the last few hours?”, use the requested time window and correlate rather than dumping logs:

1. Read monitor events and active conditions.
2. Summarize blocked SSH sources from `ssh.log`, deduplicating retransmissions by source and source port.
3. Inspect current port-22 connections and their owning processes with `lsof`; distinguish `_sshd` pre-auth from authenticated user sessions.
4. Check recent changes to authorized keys, SSH configuration, accounts, sudoers, LaunchAgents/LaunchDaemons, `/usr/local/libexec`, and executable files in temporary directories.
5. Check XProtect/Gatekeeper signals and unusual processes/listeners.
6. Confirm the live PF anchor and key-only SSH posture.

Report conclusions using evidence levels:

- **Blocked probe:** packet reached PF and was denied; no session.
- **Connection only:** TCP connection observed; authentication not established.
- **Suspicious change:** unexpected persistence, key, account, executable, or security-setting change requiring investigation.
- **Confirmed access:** corroborated authenticated session or executed process attributable to the remote source.

Never turn “internet scanning was observed” into “the Mac was breached” without corroborating evidence.

## Known posture and remaining accepted gaps

As last verified on 2026-09-04:

- SIP, Gatekeeper, XProtect, the macOS application firewall, stealth mode, PF, and key-only SSH were enabled.
- Screen Sharing, Remote Apple Events, SMB, and FTP sharing were disabled.
- FileVault was off.
- No Time Machine destination was configured.
- The legacy `/var/audit/current` trail was stale; do not rely on it as current evidence.
- Many application and Docker ports listen on LAN interfaces. PF blocks them from public access, but they remain reachable by devices on the home LAN.

These last four items are documented findings, not standing permission to change them.

## Related operations

- Little Pickles VPN and router recovery: `ai-context/22_HOME_OPS.md` and `~/workspace/ai/runbooks/services/openvpn-preschool-gateway.md`
- General Mac mini services and domains: `ai-context/24_SERVICES_AND_DOMAINS.md`
- Canonical home-ops tooling: `ai-context/26_TOOLS_CATALOG.md`
