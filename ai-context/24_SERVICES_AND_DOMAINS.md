# Services and domains (awareness)

## Friday

- Friday v2: `https://friday2.edgflix.com` (gateway nginx → `127.0.0.1:3334`, LaunchAgent `com.friday.v2`)
- Friday v1: `https://friday.edgflix.com` (separate app; heavier features: voice, life panels, comms monitoring)

## Home services (examples)

The gateway exposes multiple `*.edgflix.com` subdomains via nginx, often proxying to Docker containers (e.g. Sonarr/Radarr/torrent/qBittorrent, Jellyseerr, etc).

- `https://clients.edgflix.com` is a shared static client-sites host on the Mac mini.
- Web root: `/Users/ollie/workspace/personal/clients/sites`
- Path mapping: `/client-name/` maps to `/Users/ollie/workspace/personal/clients/sites/client-name/index.html`
- Live nginx vhost: `/opt/homebrew/etc/nginx/servers/clients.edgflix.com.conf`
- Versioned nginx config: `/Users/ollie/workspace/personal/clients/deploy/nginx/clients.edgflix.com.conf`

If a subdomain returns `502`:

- suspect the upstream process/container is down or Docker is wedged,
- verify local upstream port responds,
- then fix the root cause (restart container/Docker) only when explicitly requested.
