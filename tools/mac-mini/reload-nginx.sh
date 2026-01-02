#!/usr/bin/env bash
set -euo pipefail

# Requires sudo.
sudo nginx -t
sudo nginx -s reload

