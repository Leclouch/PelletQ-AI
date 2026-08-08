# Production Deployment — Design

## Purpose
Get PelletQ-AI running on the user's own VPS, reachable from anywhere over
HTTPS, building on top of the security hardening already done (auth
middleware, rate limiting, MQTT TLS+auth, DB not publicly exposed — see
[[2026-08-05-production-security-hardening-design]]). That work made the app
*safe* to expose; this design is what actually exposes it: containerizing
the Next.js app, TLS termination, a public domain, and a repeatable deploy
process.

## Context / constraints
- Server: user already has a VPS with SSH access, Docker + Docker Compose
  installed. No other services currently running on it.
- Domain: user owns a domain and can edit DNS records.
- Current state: Postgres + Mosquitto run via `docker-compose.yml`; the
  Next.js app itself runs directly on the host (`pnpm dev` / `next start`),
  not containerized.
- Deploy workflow: manual (SSH in, `git pull`, rebuild, restart) — no CI/CD.
  Explicitly chosen over GitHub Actions to avoid the extra setup (SSH deploy
  keys/secrets in a CI system) for a solo/small-team project.
- Reverse proxy: Caddy, chosen over Nginx+certbot for automatic cert
  issuance/renewal with minimal config — one `Caddyfile`, no cron/systemd
  timer to babysit.
- Domains: `app.<domain>` for the website, `mqtt.<domain>` for the MQTT
  broker (matches what `firmware/pelletq_esp32/README.md` already expects:
  a public domain, not IP, on port 8883).

**Out of scope:** choosing/provisioning a VPS (already have one); CI/CD
pipeline (manual deploy chosen); Nginx (Caddy chosen); multi-server/HA
setup; switching hosting to a PaaS.

## Design

### 1. Topology
```
Internet
  │
  ├─ 80/443 → Caddy (TLS termination, reverse proxy)
  │             ├─ app.<domain>  → Next.js container :3000 (proxied)
  │             └─ mqtt.<domain> → cert-only site block, no proxying
  │
  └─ 8883    → Mosquitto container (TLS, direct — ESP32s connect here,
                bypassing Caddy entirely)

Postgres:            127.0.0.1 only — never exposed (already done)
Mosquitto 1883/9001:  127.0.0.1 only — never exposed (already done)
```
Only 80, 443, and 8883 are open on the server's firewall (`ufw`); everything
else stays closed.

### 2. Containerizing the Next.js app
- `next.config.ts`: add `output: "standalone"`, so `next build` emits a
  minimal `.next/standalone` bundle (just the files needed to run, no dev
  toolchain) — this is what keeps the Docker image small.
- New `Dockerfile` (multi-stage):
  - Stage 1 (`deps`/`build`): `node:20-alpine`, `pnpm install`, `pnpm build`.
  - Stage 2 (`runtime`): fresh `node:20-alpine`, copies `.next/standalone`,
    `.next/static`, and `public/` from stage 1, runs `node server.js` on
    port 3000. No pnpm, no source, no dev deps in the final image.
- New `.dockerignore`: `node_modules`, `.next`, `.git`, `docs/`,
  `.superpowers/`, `firmware/`, `test/` — none of this belongs in the build
  context or image.
- `docker-compose.yml` gains an `app` service:
  - `build: .` (the new Dockerfile).
  - `env_file: .env`.
  - `depends_on: postgres` (healthcheck-gated, matching the existing
    Postgres healthcheck).
  - Joins the existing Compose network so it reaches Postgres/Mosquitto by
    container name: `DATABASE_URL` host becomes `postgres`, `MQTT_BROKER_URL`
    becomes `mqtt://mosquitto:1883` (both currently `localhost` in
    `.env.example` — this is a real env var change for production, called
    out in the plan).
  - Not published to the host directly — only reachable via the `caddy`
    service over the Compose network.

### 3. Caddy: reverse proxy + TLS for both app and MQTT
- `docker-compose.yml` gains a `caddy` service: official `caddy:2` image,
  publishes `80:80` and `443:443`, mounts a `Caddyfile`, and two named
  volumes (`caddy_data`, `caddy_config`) so issued certs survive container
  restarts/recreates.
- New `Caddyfile`:
  ```
  app.<domain> {
      reverse_proxy app:3000
  }

  mqtt.<domain> {
      respond "PelletQ MQTT broker — connect on 8883" 200
  }
  ```
  The `mqtt.<domain>` block does no real proxying — Mosquitto's TLS listener
  is plain TCP, not HTTP, so Caddy can't reverse-proxy it. Its only job is
  to make Caddy's automatic-HTTPS machinery obtain and renew a Let's
  Encrypt cert for that hostname (standard HTTP-01 challenge on port 80,
  which Caddy does for any site block by default). This keeps *one*
  renewal mechanism for both certs instead of running certbot separately
  for MQTT, per the user's explicit choice over a fully separate certbot
  flow.
- New sync script (e.g. `scripts/sync-mqtt-cert.sh`) + a daily cron entry on
  the host:
  - Diffs Caddy's on-disk cert for `mqtt.<domain>` (in the `caddy_data`
    volume) against what's currently in `mosquitto/certs/`.
  - On change: copies the new cert/key into the paths `mosquitto.conf`
    already expects (`fullchain.pem`, `privkey.pem`), then
    `docker compose restart mosquitto` to pick them up.
  - Exact on-disk path for Caddy's stored certs will be verified against
    the running `caddy:2` image during implementation rather than assumed
    here (Caddy's storage layout is stable but versioned by ACME CA/account
    — worth confirming live, not guessing in a spec).
  - Mosquitto file-permission gotcha already documented in `.env.example`
    (checklist item 7 — UID 1883 needs read access) applies here too: the
    sync script must set the same permissions on the copied files.

### 4. Deploy workflow (manual)
- **One-time server setup:**
  1. Clone the repo to `/opt/pelletq` (or similar).
  2. Create `.env` on the server following the existing `.env.example`
     checklist — all 7 items already documented there (DB password,
     `AUTH_SECRET`, seed admin password, MQTT credentials, TLS certs,
     firmware secrets, file permissions) — plus the `DATABASE_URL`/
     `MQTT_BROKER_URL` host changes from §2.
  3. `ufw allow 80,443,8883/tcp` — no other ports opened.
  4. Generate Mosquitto's `password_file` and DNS records for `app.<domain>`
     / `mqtt.<domain>` pointing at the server IP.
  5. `docker compose up -d` — brings up Postgres, Mosquitto, the app, and
     Caddy together. First TLS issuance happens automatically on Caddy's
     first request per domain.
  6. `pnpm prisma migrate deploy` + `pnpm prisma db seed` (inside the app
     container) to initialize the database.
  7. Run the cert-sync script once manually (rather than waiting for the
     next cron tick) so port 8883 works immediately instead of after up to
     24h, then restart Mosquitto.
- **Ongoing deploys:** a `deploy.sh` wrapping:
  ```
  git pull
  docker compose build app
  docker compose up -d
  docker compose exec app pnpm prisma migrate deploy
  ```
  One command instead of four, run manually over SSH after each set of
  changes is ready to ship.

## Testing
No new automated tests — this is infra/config, not application logic. The
implementation plan will include a manual verification checklist: app
reachable over `https://app.<domain>` with a valid cert, login works
(`AUTH_TRUST_HOST` already set for this), MQTT reachable on
`mqtt.<domain>:8883` with a real TLS client, Postgres/Mosquitto plain
listeners unreachable from outside the server, and an ESP32 bench test
against the production broker domain (the security-hardening design already
flagged TLS handshake RAM overhead on the ESP32 as a real risk needing a
live bench test — this deployment is what finally makes that test possible
end-to-end).
