# Deploying PelletQ-AI to Your Own Server

This is a step-by-step walkthrough for taking PelletQ-AI from your dev machine
to a server you control, reachable over HTTPS from anywhere — including a
homelab behind CGNAT with no public IP. It expands on the "Deploy ke Server
Sendiri (VPS)" section in the main `README.md` — that stays the source of
truth if the two ever drift; this file is the same procedure with more
explanation for a first-time deploy.

## What you're setting up

Five containers, managed by one `docker-compose.yml`, all running with
`network_mode: host` (needed to get this working reliably on the reference
deployment host, WSL2) — every container shares the host's network stack
directly instead of a Docker bridge network, so services reach each other via
`localhost`, not container names:

| Service       | What it does                          | Listens on (host) |
|---------------|----------------------------------------|-----------------|
| `postgres`    | Main database                          | `5432` |
| `mosquitto`   | MQTT broker the ESP32 talks to         | `1883` (plain MQTT), `9001` (MQTT over WebSocket) — reached from outside via `cloudflared` |
| `adminer`     | DB admin UI                            | `8080` |
| `app`         | The Next.js app itself                 | `3001` (set via `PORT` in `docker-compose.yml`) — reached from outside via `cloudflared` |
| `cloudflared` | Cloudflare Tunnel client               | makes outbound connections only; nothing to publish |

> **Known gap:** because these containers use `network_mode: host` and none
> of postgres/mosquitto/adminer/app currently bind explicitly to `127.0.0.1`,
> they listen on **all** host network interfaces (`0.0.0.0`), not just
> loopback. Docker's own `ports:`-based loopback binding (`127.0.0.1:PORT:PORT`)
> has no effect under `network_mode: host` — it's simply not consulted. On the
> reference deployment host this is only currently safe if the host's own
> firewall (or its exposure to the network) blocks inbound connections to
> those ports from anything other than the machine itself. If you deploy this
> way, either add host firewall rules for those ports, or bind each service to
> `127.0.0.1` (Postgres's `listen_addresses`, Mosquitto's `listener <port>
> 127.0.0.1` in `mosquitto.conf`, Adminer's startup `command`, and the app's
> `HOSTNAME` env var) before exposing the host to any untrusted network.

There is no reverse proxy or certificate manager running on the server.
`cloudflared` opens an outbound connection to Cloudflare's edge and Cloudflare
routes two public hostnames to it: your app's domain to `localhost:3001`, and
your MQTT domain to `localhost:9001` (Mosquitto's WebSocket listener) — both
reached over the host network, not Docker's internal DNS. Cloudflare
terminates TLS at its edge using its own publicly-trusted certificate — you
never request, renew, or manage a certificate yourself. Because the tunnel is
outbound-only, this works even if the server has no public IP and sits behind
carrier-grade NAT (CGNAT): there is nothing to port-forward.

The tradeoff: the ESP32 connects over MQTT-over-WebSocket (`wss://`), not raw
MQTT-over-TLS on port 8883. Cloudflare's free tier proxies HTTP/WebSocket
traffic but not arbitrary raw TCP (that's the paid Spectrum product), so
WebSocket is the transport that fits the free tier. The hop from `cloudflared`
to `mosquitto` inside the Docker network is plain WebSocket (no TLS) — that's
fine, because it's internal-only traffic that never leaves the server; the
public-facing leg (ESP32 to Cloudflare's edge) is encrypted.

## Before you start

You need:

- A server with Docker and Docker Compose installed. SSH access. No public
  IP or port-forwarding required.
- A domain name.
- The domain's DNS managed by Cloudflare (free tier is enough). If it's
  currently on another registrar's DNS, change the nameservers at your
  registrar to Cloudflare's — Cloudflare's dashboard shows you exactly which
  ones after you add the site.
- Two subdomains in mind, e.g. `app.yourdomain.com` and `mqtt.yourdomain.com`.
  You don't create DNS records for these by hand — Cloudflare creates them
  automatically when you add the tunnel's public hostnames in step 5.

## 1. Clone the repo onto the server

```bash
git clone <your-repo-url> /opt/pelletq
cd /opt/pelletq
```

## 2. Create your production `.env`

Copy `.env.example` to `.env` and fill in real values. Do not commit this
file — it's already gitignored.

```bash
cp .env.example .env
```

Then edit `.env` and set, at minimum:

| Variable | What to put |
|---|---|
| `POSTGRES_PASSWORD` | A new strong password — required, Compose refuses to start without it |
| `DATABASE_URL` | Must match `POSTGRES_PASSWORD` above — same password in both |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32`. Never reuse the dev one. |
| `SEED_ADMIN_PASSWORD` | A strong password for the initial admin login — required, the seed refuses to run without it |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | New credentials, not your dev/bench ones (you'll create the actual password file in step 3) |
| `TUNNEL_TOKEN` | From the Cloudflare Tunnel you create in step 4 — leave blank until then |

`AUTH_TRUST_HOST="true"` should already be set — required because the app
sits behind a reverse proxy (Cloudflare's edge, via the tunnel).

## 3. Create the Mosquitto password file

```bash
docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -c /mosquitto/config/passwd <username>
chmod 644 mosquitto/config/passwd
```

Use the same username/password here that you put in `MQTT_USERNAME` /
`MQTT_PASSWORD` in `.env` — the ESP32 firmware and the broker both need to
agree on these credentials (see `firmware/pelletq_esp32/README.md`).

## 4. Create the Cloudflare Tunnel

In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a
tunnel** (choose "Cloudflared" as the connector type). Name it whatever you
like (e.g. `pelletq`). Cloudflare shows you a token on the install step —
copy it into `TUNNEL_TOKEN` in `.env`.

## 5. Add the two public hostnames

Still in the tunnel's configuration screen, under **Public Hostnames**, add:

| Public hostname | Service |
|---|---|
| `app.yourdomain.com` (your real `APP_DOMAIN`) | `http://localhost:3001` |
| `mqtt.yourdomain.com` (your real `MQTT_DOMAIN`) | `http://localhost:9001` |

The service field targets `localhost` because every container, including
`cloudflared`, runs with `network_mode: host` and shares the host's network
stack — there is no internal Docker network for `cloudflared` to resolve
container names against. Saving these hostnames is what makes Cloudflare
create the DNS records automatically; there is no separate DNS step.

## 6. Start the stack

```bash
docker compose up -d
```

`cloudflared` will connect outbound to Cloudflare immediately. Check
`docker compose logs cloudflared` — you want to see it report a healthy
connection, not repeated connection errors (which usually means
`TUNNEL_TOKEN` is wrong or missing).

## 7. Run migrations and seed the database

```bash
docker compose run --rm migrate migrate deploy
docker compose run --rm migrate db seed
```

This applies the Prisma schema and creates the initial admin user from
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` in `.env`. The `migrate`
service only ever runs on-demand like this — it never starts on its own.

## Verify it all works

- `https://<APP_DOMAIN>/login` loads from an outside network.
- `docker compose logs cloudflared` shows the tunnel connected, no errors
  about the public hostnames.
- An MQTT client that supports WebSocket transport can connect to
  `wss://<MQTT_DOMAIN>` and publish/subscribe on the `pelletq/*` topics.
- From outside the server, ports 5432, 1883, 9001, and 8080 should fail to
  connect directly. **As shipped, this will not pass** — see the "Known gap"
  note above; these ports are host-wide (`0.0.0.0`) under `network_mode: host`
  unless you've added firewall rules or bound each service to `127.0.0.1`
  yourself.

## Deploying future changes

Once the server is set up, shipping a new version is one command from the
project root:

```bash
./scripts/deploy.sh
```

This does, in order: `git pull`, rebuilds the `app` and `migrate` Docker
images, runs `prisma migrate deploy` against the new schema, then brings the
stack up with the new code. Migrations always run before traffic shifts to
the new version. `cloudflared` doesn't need anything special on redeploy —
`docker compose up -d` just restarts it alongside everything else, and it
reconnects to Cloudflare automatically.

## Pre-launch security checklist

- [ ] `SEED_ADMIN_PASSWORD` set to a strong value
- [ ] `AUTH_SECRET` is new, secret, and not committed anywhere
- [ ] `POSTGRES_PASSWORD` set to a strong value
- [ ] `MQTT_USERNAME`/`MQTT_PASSWORD` changed from dev/bench credentials
- [ ] `TUNNEL_TOKEN` is secret and not committed anywhere
- [ ] No ports opened manually in any firewall or router — `cloudflared`
      only makes outbound connections. **Note:** unlike a bridge-network
      setup, `network_mode: host` does not loopback-restrict Postgres, plain
      MQTT, MQTT WebSocket, or Adminer by itself (see "Known gap" above) —
      you must add host firewall rules or explicit `127.0.0.1` binds for
      those services yourself if the host is reachable from any untrusted
      network.

## Troubleshooting

- **`https://<APP_DOMAIN>` doesn't load** — check
  `docker compose logs cloudflared` first. Confirm the public hostname in
  the Cloudflare dashboard points at `http://localhost:3001` exactly, and that
  `app` is actually running (`docker compose ps`).
- **MQTT WebSocket client can't connect** — same idea: check the
  `mqtt.yourdomain.com` → `http://localhost:9001` mapping in the dashboard,
  and confirm Mosquitto's `mosquitto.conf` still has `listener 9001` with
  `protocol websockets`.
- **App can't reach the database** — `docker compose ps` should show
  `postgres` as `healthy`; if not, check `docker compose logs postgres`.
- **Login redirects back to `/login` after a "successful" login** — usually
  `AUTH_TRUST_HOST` isn't set to `"true"`.
- **Tunnel connects but a hostname 404s or times out** — the public hostname
  route can take a minute to propagate after you save it in the dashboard;
  also double check for a typo between the hostname you configured and the
  actual `APP_DOMAIN`/`MQTT_DOMAIN` DNS name.
