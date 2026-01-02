#!/usr/bin/env bash
set -euo pipefail

# One-time setup on the Mac mini (run as user `ollie`).
#
# This script:
# - writes a LaunchAgent to run Friday v2 on port 3334
# - starts it via launchctl
#
# nginx (443 + subdomain) is configured separately and requires sudo for reload.

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"

PLIST="$HOME/Library/LaunchAgents/com.friday.v2.plist"
mkdir -p "$HOME/Library/Logs/friday-v2"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.friday.v2</string>
    <key>WorkingDirectory</key><string>${ROOT_DIR}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>${ROOT_DIR}/server/server.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PORT</key><string>3334</string>
      <key>NODE_ENV</key><string>production</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${HOME}/Library/Logs/friday-v2/out.log</string>
    <key>StandardErrorPath</key><string>${HOME}/Library/Logs/friday-v2/err.log</string>
  </dict>
</plist>
PLIST

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

sleep 1
curl -sS --max-time 2 "http://127.0.0.1:3334/api/health"
echo

