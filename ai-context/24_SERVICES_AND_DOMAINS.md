# Services and domains (awareness)

## Friday

- Friday v2: `https://friday2.edgflix.com` (gateway nginx → `127.0.0.1:3334`, LaunchAgent `com.friday.v2`)
- Friday v1: `https://friday.edgflix.com` (separate app; heavier features: voice, life panels, comms monitoring)

## Home services (examples)

The gateway exposes multiple `*.edgflix.com` subdomains via nginx, often proxying to Docker containers (e.g. Sonarr/Radarr/torrent/qBittorrent, Jellyseerr, etc).

If a subdomain returns `502`:

- suspect the upstream process/container is down or Docker is wedged,
- verify local upstream port responds,
- then fix the root cause (restart container/Docker) only when explicitly requested.

