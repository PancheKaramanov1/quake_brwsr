# Browser Multiplayer Deployment

## Components

| Piece | What to deploy |
| ----- | -------------- |
| Client | Vite static build (`npm run build` → `dist/`) on any static host / CDN |
| Game server | Node process (`npm run server:build` → `dist-server/`) or Docker image |
| TLS / WSS | Reverse proxy (nginx recommended) terminating HTTPS and proxying `/ws` |

The game server does **not** serve the Babylon client; host them separately (or same origin via nginx).

## Environment (production)

Set at least:

```bash
NODE_ENV=production
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
PUBLIC_SERVER_URL=https://game.example.com
WS_PATH=/ws
ALLOWED_ORIGINS=https://play.example.com
MAX_PLAYERS=12
SERVER_TICK_RATE=60
SNAPSHOT_RATE=20
LOG_LEVEL=info
```

Client build:

```bash
VITE_GAME_SERVER_URL=wss://game.example.com/ws npm run build
```

In production, empty `Origin` on WebSocket upgrade is **rejected** (non-browser tools must send an allowed origin, or run outside prod). Do not leave `ALLOWED_ORIGINS=*` in production unless you accept open embedding.

## Docker (server)

`Dockerfile` multi-stage build:

1. `npm ci` + `npm run server:build`
2. Runtime image: `npm ci --omit=dev`, copy `dist-server/`, expose **8080**
3. Healthcheck: `GET /health`

```bash
docker build -t quake-brwsr-server .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=https://play.example.com \
  -e PUBLIC_SERVER_URL=https://game.example.com \
  quake-brwsr-server
```

## HTTP endpoints

| Path | Role |
| ---- | ---- |
| `GET /health` (also `/healthz`) | Liveness: `{ status, uptimeMs }` |
| `GET /ready` (also `/readyz`) | Readiness while accepting connections |
| `GET /metrics` | Tick timing, players, snapshot size, bytes in/out, phase |
| `WS /ws` | Game protocol (configurable via `WS_PATH`) |

Use `/health` for container healthchecks and `/ready` for load balancer drain during shutdown (`SIGINT`/`SIGTERM` stop accepting and notify clients).

## nginx: HTTPS client + WSS reverse proxy

Example: static client at `play.example.com`, game server on `127.0.0.1:8080`, public WSS at `game.example.com`.

```nginx
# Static client
server {
    listen 443 ssl http2;
    server_name play.example.com;

    ssl_certificate     /etc/letsencrypt/live/play.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/play.example.com/privkey.pem;

    root /var/www/quake-brwsr/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Game server (WSS + health)
server {
    listen 443 ssl http2;
    server_name game.example.com;

    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;

    location /health {
        proxy_pass http://127.0.0.1:8080/health;
    }
    location /ready {
        proxy_pass http://127.0.0.1:8080/ready;
    }
    location /metrics {
        # Prefer restricting by IP or auth in real deployments
        proxy_pass http://127.0.0.1:8080/metrics;
        allow 127.0.0.1;
        deny all;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Same-origin alternative: serve `dist/` and proxy `/ws` under one hostname so `VITE_GAME_SERVER_URL` can be `wss://play.example.com/ws` and `ALLOWED_ORIGINS` matches that origin.

## Operational notes

- One Node process = one FFA match (scale out with multiple instances + matchmaking later).
- Prefer keeping tick at 60 Hz; watch `/metrics` `tickP95` / `tickMax` under load.
- Reconnect grace defaults to 15 s; clients hold `sessionId` + `reconnectToken` from `Welcome`.
- Ensure proxy buffers do not coalesce or delay WebSocket frames (disable request buffering if your proxy enables it by default for HTTP).
