# Deploying PelletQ-AI to Your Own Server

This is a step-by-step walkthrough for taking PelletQ-AI from your dev machine
to a server you control, reachable over HTTPS from anywhere — including a
homelab behind CGNAT with no public IP. It expands on the "Deploy ke Server
Sendiri (VPS)" section in the main `README.md` — that stays the source of
truth if the two ever drift; this file is the same procedure with more
explanation for a first-time deploy.

## What you're setting up

Five containers, managed by one `docker-compose.yml`:

| Service       | What it does                          | Reachable from |
|---------------|----------------------------------------|-----------------|
| `postgres`    | Main database                          | localhost only |
| `mosquitto`   | MQTT broker the ESP32 talks to         | localhost only — reached from outside via `cloudflared`, not a published port |
| `adminer`     | DB admin UI                            | localhost only |
| `app`         | The Next.js app itself                 | not published — only reachable through `cloudflared` |
| `cloudflared` | Cloudflare Tunnel client               | makes outbound connections only; nothing to publish |

There is no reverse proxy or certificate manager running on the server.
`cloudflared` opens an outbound connection to Cloudflare's edge and Cloudflare
routes two public hostnames to it: your app's domain to `app:3000`, and your
MQTT domain to `mosquitto:9001` (Mosquitto's WebSocket listener). Cloudflare
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
| `POSTGRES_PASSWORD` | A new strong password (not the `pelletq_dev_password` default) |
| `DATABASE_URL` | Must match `POSTGRES_PASSWORD` above — same password in both |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32`. Never reuse the dev one. |
| `SEED_ADMIN_PASSWORD` | A strong password for the initial admin login (the dev default `admin321` must not be used in production) |
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
| `app.yourdomain.com` (your real `APP_DOMAIN`) | `http://app:3000` |
| `mqtt.yourdomain.com` (your real `MQTT_DOMAIN`) | `http://mosquitto:9001` |

The service field uses Docker Compose service names — `cloudflared` reaches
`app` and `mosquitto` by name over the internal Docker network, the same way
they reach `postgres`. Saving these hostnames is what makes Cloudflare create
the DNS records automatically; there is no separate DNS step.

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
- From outside the server, ports 5432, 1883, 9001, and 8081 all fail to
  connect directly (confirms the loopback bindings are working and nothing
  is reachable except through the tunnel).

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

- [ ] `SEED_ADMIN_PASSWORD` changed from `admin321`
- [ ] `AUTH_SECRET` is new, secret, and not committed anywhere
- [ ] `POSTGRES_PASSWORD` changed from `pelletq_dev_password`
- [ ] `MQTT_USERNAME`/`MQTT_PASSWORD` changed from dev/bench credentials
- [ ] `TUNNEL_TOKEN` is secret and not committed anywhere
- [ ] No ports opened manually in any firewall or router — `cloudflared`
      only makes outbound connections. Postgres, plain MQTT, MQTT WebSocket,
      and Adminer stay loopback-only in `docker-compose.yml`.

## Troubleshooting

- **`https://<APP_DOMAIN>` doesn't load** — check
  `docker compose logs cloudflared` first. Confirm the public hostname in
  the Cloudflare dashboard points at `http://app:3000` exactly, and that
  `app` is actually running (`docker compose ps`).
- **MQTT WebSocket client can't connect** — same idea: check the
  `mqtt.yourdomain.com` → `http://mosquitto:9001` mapping in the dashboard,
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
