# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get PelletQ-AI running on the user's own VPS behind HTTPS, reachable from anywhere, by containerizing the Next.js app and adding Caddy as a reverse proxy/TLS terminator for both the web app and the MQTT broker's certificate.

**Architecture:** Dockerize the Next.js app (multi-stage build using Next's `standalone` output) and add it as an `app` service in the existing `docker-compose.yml` alongside Postgres/Mosquitto. Add a `caddy` service that terminates TLS for `app.<domain>` (reverse-proxied to the app) and also owns the Let's Encrypt cert for `mqtt.<domain>` (no proxying — Mosquitto's TLS listener is raw TCP, not HTTP), which a small script syncs into `mosquitto/certs/`. Deploys are manual: SSH in, `git pull`, rebuild, restart.

**Tech Stack:** Docker + Docker Compose, Caddy 2, Next.js 16 standalone output, existing Prisma 7 (`@prisma/adapter-pg`, WASM query compiler — no native engine binary) + Postgres + Mosquitto stack.

## Global Constraints

- Node version in any Docker image **must be ≥ 22.13** — `package.json` pins `packageManager: pnpm@11.12.0`, and that pnpm version refuses to run under Node 20 (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`, verified empirically). Use `node:22-alpine`, not `node:20-alpine`, contrary to the README's current "Node.js ≥ 20" prerequisite text (which Task 7 also corrects).
- Prisma's generated client (`.prisma/client` — the WASM query compiler + generated types) is **not** followed by Next.js's `output: "standalone"` file tracer through pnpm's nested store layout. It must be copied into the traced output manually in the Dockerfile (exact command verified in Task 2) or the app crashes on any Prisma-touching request.
- No CI/CD — deploys are manual SSH + `git pull` (user's explicit choice).
- Caddy is the reverse proxy / TLS terminator (user's explicit choice over Nginx+certbot).
- Two subdomains: `app.<domain>` (website) and `mqtt.<domain>` (broker cert only, no HTTP service) — user's explicit choice.
- Adminer's port mapping must be loopback-only (`127.0.0.1:8081:8080`), matching the fix already applied to Postgres — user's explicit choice after the exposure was flagged.
- Every verification command in this plan was actually run against this repo during planning (Docker build, boot test, live `prisma migrate deploy` against the real dev Postgres container, live Caddy cert issuance inspection, live `docker compose run`+`profiles` behavior) — re-run them for real during execution, don't skip them as "probably fine."

---

### Task 1: Standalone Next.js build output

**Files:**
- Modify: `next.config.ts:29`

**Interfaces:**
- Produces: `.next/standalone/server.js` after `pnpm build` — Task 2's Dockerfile copies this.

- [ ] **Step 1: Add `output: "standalone"` to the Next.js config**

In `next.config.ts`, change:
```ts
const nextConfig: NextConfig = {
  async headers() {
```
to:
```ts
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
```

- [ ] **Step 2: Build and verify the standalone output exists**

Run: `pnpm build`
Expected: build succeeds, and `.next/standalone/server.js` exists. Verify with:
```bash
test -f .next/standalone/server.js && echo "FOUND"
```
Expected output: `FOUND`

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(deploy): emit standalone Next.js build output for Docker"
```

---

### Task 2: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `.next/standalone/server.js` (Task 1).
- Produces: a `pelletq-app` image, `EXPOSE 3000`, `CMD ["node", "server.js"]` — Task 3's `app` service builds from this.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
docs
.claude
.superpowers
.worktrees
firmware
test
.env
.env.*
*.tsbuildinfo
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# Next.js's standalone output tracer doesn't follow the generated Prisma
# client into pnpm's nested store layout, so `.prisma/client` (the WASM
# query compiler + generated types) is missing from .next/standalone
# unless copied in manually here, next to where @prisma/client itself
# already landed in the traced output.
RUN SRC=$(find node_modules/.pnpm -maxdepth 3 -type d -path '*/@prisma+client@*/node_modules/.prisma') && \
    DEST_PARENT=$(find .next/standalone/node_modules/.pnpm -maxdepth 3 -type d -path '*/@prisma+client@*/node_modules') && \
    cp -r "$SRC" "$DEST_PARENT/.prisma"

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t pelletq-app:local .`
Expected: build completes successfully, ending in `naming to docker.io/library/pelletq-app:local`.

- [ ] **Step 4: Boot-test the image without a real database/broker**

`/login` doesn't touch Prisma or MQTT (both are lazy-initialized only when actually queried/published), so it's a safe smoke-test route that only needs `AUTH_SECRET` set.

```bash
docker run -d --name pelletq-app-test -p 13000:3000 \
  -e AUTH_SECRET="test-secret" \
  -e AUTH_TRUST_HOST="true" \
  -e DATABASE_URL="postgresql://dummy:dummy@dummy:5432/dummy" \
  -e MQTT_BROKER_URL="mqtt://dummy:1883" \
  pelletq-app:local
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:13000/login
docker logs pelletq-app-test
docker rm -f pelletq-app-test
```
Expected: `HTTP 200`, no errors in the logs (a clean `✓ Ready` line, no stack trace).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): add multi-stage Dockerfile for the Next.js app"
```

---

### Task 3: docker-compose.yml — Postgres password via env var, Adminer loopback-only, `app` + `migrate` services

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the `pelletq-app` image built in Task 2 (`app` service builds from the same `Dockerfile`, `target: runtime`; `migrate` service builds `target: build` — the stage that still has `pnpm`/`prisma` CLI available, since the `runtime` stage deliberately doesn't).
- Produces: `app` service reachable at `app:3000` on the compose network (not published to the host) — Task 4's `caddy` service proxies to this. `migrate` service invoked via `docker compose run --rm migrate <prisma-subcommand>` — Task 6's `deploy.sh` uses `migrate deploy`.

- [ ] **Step 1: Add `POSTGRES_PASSWORD` to `.env.example`**

In `.env.example`, add a new var near `DATABASE_URL` and update checklist item 1 (which currently says to edit `docker-compose.yml` directly):

Replace:
```
#   1. DATABASE_URL: ganti password Postgres dev ("pelletq_dev_password")
#      dengan kredensial baru — update juga POSTGRES_PASSWORD di
#      docker-compose.yml.
```
with:
```
#   1. POSTGRES_PASSWORD: ganti dari default "pelletq_dev_password" di .env
#      ini SAJA — docker-compose.yml membaca variabel ini, jangan diedit
#      langsung di docker-compose.yml. DATABASE_URL di bawah ini juga harus
#      diupdate agar password-nya cocok.
```

Add a new line right after the `# Database` heading:
```
POSTGRES_PASSWORD="pelletq_dev_password"
```
(placed above the existing `DATABASE_URL=` line)

- [ ] **Step 2: Update `docker-compose.yml`'s `postgres` and `adminer` services**

In the `postgres` service, change:
```yaml
    environment:
      POSTGRES_USER: pelletq
      POSTGRES_PASSWORD: pelletq_dev_password
      POSTGRES_DB: pelletq
```
to:
```yaml
    environment:
      POSTGRES_USER: pelletq
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-pelletq_dev_password}
      POSTGRES_DB: pelletq
```

In the `adminer` service, change:
```yaml
    ports:
      - "8081:8080"
```
to:
```yaml
    ports:
      - "127.0.0.1:8081:8080"
```

- [ ] **Step 3: Add `app` and `migrate` services**

Append to `docker-compose.yml`, after the `adminer` service:

```yaml
  app:
    build:
      context: .
      target: runtime
    container_name: pelletq-app
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://pelletq:${POSTGRES_PASSWORD:-pelletq_dev_password}@postgres:5432/pelletq?schema=public
      MQTT_BROKER_URL: mqtt://mosquitto:1883
    depends_on:
      postgres:
        condition: service_healthy

  migrate:
    build:
      context: .
      target: build
    env_file: .env
    environment:
      DATABASE_URL: postgresql://pelletq:${POSTGRES_PASSWORD:-pelletq_dev_password}@postgres:5432/pelletq?schema=public
    depends_on:
      postgres:
        condition: service_healthy
    entrypoint: ["pnpm", "exec", "prisma"]
    profiles: ["tools"]
```

`app` is not published to the host — only reachable via the compose network (Task 4's Caddy fronts it). `migrate` reuses the `build` stage (still has the `pnpm`/`prisma` CLI, unlike the pruned `runtime` stage) and sits behind the `tools` profile so `docker compose up -d` never starts it — it only runs via explicit `docker compose run --rm migrate <subcommand>`.

- [ ] **Step 4: Validate the compose file**

Run: `docker compose config -q`
Expected: no output, exit code 0 (silently valid). If it errors, fix the YAML before continuing.

- [ ] **Step 5: Bring up Postgres, Mosquitto, and the app; run migrations**

```bash
docker compose up -d postgres mosquitto app
docker compose ps postgres --format '{{.Status}}'   # wait until it says "healthy"
docker compose run --rm migrate migrate deploy
```
Expected: the last command prints `No pending migrations to apply.` (or applies any that are pending) — not an error.

- [ ] **Step 6: Verify the app container serves a request over the internal network**

`app` isn't published to the host, so test from inside its own container:
```bash
docker compose exec app node -e "require('http').get('http://localhost:3000/login', res => { console.log(res.statusCode); process.exit(res.statusCode === 200 ? 0 : 1); })"
```
Expected: prints `200`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(deploy): containerize the Next.js app, wire it to Postgres/Mosquitto, lock down Adminer"
```

---

### Task 4: Caddy service + Caddyfile

**Files:**
- Create: `Caddyfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `app` service on the compose network (Task 3), `APP_DOMAIN`/`MQTT_DOMAIN` env vars.
- Produces: TLS-terminated `https://app.<domain>` reverse-proxied to `app:3000`; a Let's Encrypt cert for `mqtt.<domain>` stored in the `caddy_data` volume — Task 5's sync script reads it from there.

- [ ] **Step 1: Add `APP_DOMAIN` / `MQTT_DOMAIN` to `.env.example`**

Add near the top of the file, after the checklist block:
```
# Domain publik (produksi) — dipakai Caddy untuk reverse proxy + TLS.
APP_DOMAIN="app.yourdomain.com"
MQTT_DOMAIN="mqtt.yourdomain.com"
```

- [ ] **Step 2: Create `Caddyfile`**

```
{$APP_DOMAIN} {
	reverse_proxy app:3000
}

{$MQTT_DOMAIN} {
	respond "PelletQ MQTT broker — connect on 8883" 200
}
```
The second block does no proxying — Mosquitto's TLS listener is raw TCP, not HTTP, so Caddy can't reverse-proxy it. Its only job is to make Caddy's automatic-HTTPS machinery obtain and renew a Let's Encrypt cert for that hostname.

- [ ] **Step 3: Add the `caddy` service to `docker-compose.yml`**

Append after the `migrate` service:
```yaml
  caddy:
    image: caddy:2
    container_name: pelletq-caddy
    restart: unless-stopped
    env_file: .env
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
```

Add `caddy_data` and `caddy_config` to the top-level `volumes:` block (alongside the existing `postgres_data`, `mosquitto_data`, `mosquitto_log`).

- [ ] **Step 4: Validate the compose file**

Run: `docker compose config -q`
Expected: no output, exit code 0.

- [ ] **Step 5: Smoke-test the reverse proxy + TLS wiring locally, without touching real DNS/`.env`**

Real ACME issuance needs a publicly-reachable domain, which isn't available in a dev environment. Caddy's automatic HTTPS already handles non-public hostnames (like `localhost`) by issuing a locally-trusted cert via its internal CA instead of ACME — this proves the `reverse_proxy` + TLS wiring works without touching Let's Encrypt. Use a throwaway Caddyfile so the real one is never modified:

```bash
mkdir -p /tmp/caddy-smoketest
cat > /tmp/caddy-smoketest/Caddyfile <<'EOF'
{
	local_certs
}

localhost {
	reverse_proxy app:3000
}
EOF

docker compose run --rm -d --name caddy-smoketest \
  -v /tmp/caddy-smoketest/Caddyfile:/etc/caddy/Caddyfile \
  -p 8443:443 \
  caddy

sleep 3
curl -sk -o /dev/null -w "HTTP %{http_code}\n" https://localhost:8443/login
docker rm -f caddy-smoketest
rm -rf /tmp/caddy-smoketest
```
Expected: `HTTP 200` — confirms Caddy terminated TLS and successfully reverse-proxied to the `app` container over the compose network.

- [ ] **Step 6: Commit**

```bash
git add Caddyfile docker-compose.yml .env.example
git commit -m "feat(deploy): add Caddy as reverse proxy and TLS terminator"
```

---

### Task 5: MQTT cert sync script

**Files:**
- Create: `scripts/sync-mqtt-cert.sh`

**Interfaces:**
- Consumes: the `caddy` service's `/data/caddy/certificates` (Task 4), `MQTT_DOMAIN` env var, `mosquitto/certs/` (paths `mosquitto/config/mosquitto.conf` already expects: `fullchain.pem`, `chain.pem`, `privkey.pem`).
- Produces: updates `mosquitto/certs/{fullchain.pem,chain.pem,privkey.pem}` and restarts the `mosquitto` service when the cert changes. Task 7's docs reference running this via cron.

Caddy's on-disk cert layout nests certs under an issuer-specific directory name that isn't worth hardcoding (verified empirically: locally-issued certs land under `.../certificates/local/<domain>/`, ACME-issued ones under `.../certificates/acme-v02.api.letsencrypt.org-directory/<domain>/`) — the script searches for the domain's directory instead of assuming the issuer path segment. It pulls files out via `docker compose cp`, which works identically regardless of the host's storage driver (no assumptions about `/var/lib/docker/volumes/...` paths).

Mosquitto's `cafile` directive (`chain.pem`) is only actively used to verify *client* certificates, which this setup doesn't do (`require_certificate` isn't set in `mosquitto.conf`) — so its exact chain content isn't security-critical here, it just needs to be a valid PEM. The script reuses the same full-chain file for it.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${MQTT_DOMAIN:?MQTT_DOMAIN must be set (see .env)}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

docker compose cp caddy:/data/caddy/certificates "$TMP_DIR/certs"

CERT_DIR=$(find "$TMP_DIR/certs" -type d -name "$MQTT_DOMAIN" | head -n1)
if [ -z "$CERT_DIR" ]; then
  echo "No cert directory found for $MQTT_DOMAIN yet — has Caddy issued it? (check: docker compose logs caddy)" >&2
  exit 1
fi

SRC_CRT="$CERT_DIR/$MQTT_DOMAIN.crt"
SRC_KEY="$CERT_DIR/$MQTT_DOMAIN.key"
DEST_DIR="mosquitto/certs"
DEST_CRT="$DEST_DIR/fullchain.pem"
DEST_CHAIN="$DEST_DIR/chain.pem"
DEST_KEY="$DEST_DIR/privkey.pem"

if [ ! -f "$SRC_CRT" ] || [ ! -f "$SRC_KEY" ]; then
  echo "Cert/key files missing in $CERT_DIR" >&2
  exit 1
fi

if [ -f "$DEST_CRT" ] && cmp -s "$SRC_CRT" "$DEST_CRT"; then
  echo "Cert for $MQTT_DOMAIN unchanged, nothing to do."
  exit 0
fi

mkdir -p "$DEST_DIR"
cp "$SRC_CRT" "$DEST_CRT"
cp "$SRC_CRT" "$DEST_CHAIN"
cp "$SRC_KEY" "$DEST_KEY"
chmod 644 "$DEST_CRT" "$DEST_CHAIN" "$DEST_KEY"

echo "Cert for $MQTT_DOMAIN updated, restarting mosquitto..."
docker compose restart mosquitto
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/sync-mqtt-cert.sh
```

- [ ] **Step 3: Verify syntax**

Run: `bash -n scripts/sync-mqtt-cert.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Test the copy logic against a real (locally-issued) cert**

Reuses the `caddy-smoketest` pattern from Task 4 to produce a real cert Caddy has actually issued, then runs the script against it (redirecting its `mosquitto restart` call to a harmless no-op by using a throwaway compose project so it doesn't touch the real `mosquitto` service):

```bash
mkdir -p /tmp/mqtt-cert-test/mosquitto/certs
cat > /tmp/mqtt-cert-test/docker-compose.yml <<'EOF'
services:
  caddy:
    image: caddy:2
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
  mosquitto:
    image: alpine
    command: sleep infinity
volumes:
  caddy_data:
EOF
cat > /tmp/mqtt-cert-test/Caddyfile <<'EOF'
{
	local_certs
}

mqtt.localtest {
	respond "ok" 200
}
EOF
cp scripts/sync-mqtt-cert.sh /tmp/mqtt-cert-test/

cd /tmp/mqtt-cert-test
docker compose up -d
sleep 4
MQTT_DOMAIN=mqtt.localtest bash sync-mqtt-cert.sh
ls -la mosquitto/certs/
echo "--- second run should say unchanged ---"
MQTT_DOMAIN=mqtt.localtest bash sync-mqtt-cert.sh
docker compose down -v
cd /home/wafdan/projects/PKM/PelletQ-AI
rm -rf /tmp/mqtt-cert-test
```
Expected: first run prints `Cert for mqtt.localtest updated, restarting mosquitto...`, `mosquitto/certs/` contains `fullchain.pem`, `chain.pem`, `privkey.pem`. Second run prints `Cert for mqtt.localtest unchanged, nothing to do.`

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-mqtt-cert.sh
git commit -m "feat(deploy): sync Caddy-issued MQTT cert into mosquitto/certs/"
```

---

### Task 6: Deploy script

**Files:**
- Create: `scripts/deploy.sh`

**Interfaces:**
- Consumes: `migrate` service (Task 3).

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull
docker compose build app
docker compose up -d
docker compose run --rm migrate migrate deploy
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/deploy.sh
```

- [ ] **Step 3: Verify syntax**

Run: `bash -n scripts/deploy.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat(deploy): add one-command deploy script"
```

---

### Task 7: Docs — `.env.example` checklist and README production section

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add `mosquitto_passwd` file-permission note reminder is already present; add cert-sync note to `.env.example`'s checklist item 5**

Replace:
```
#   5. Sertifikat TLS Mosquitto (mosquitto/certs/): pasang cert Let's
#      Encrypt asli untuk domain broker sebelum listener 8883 dipakai
#      ESP32 — lihat catatan deploy di firmware/pelletq_esp32/README.md.
```
with:
```
#   5. Sertifikat TLS Mosquitto (mosquitto/certs/): dapat otomatis lewat
#      `scripts/sync-mqtt-cert.sh` (menarik cert MQTT_DOMAIN dari volume
#      Caddy) — jalankan sekali manual saat first deploy, lalu jadwalkan via
#      cron harian. Lihat README bagian "Deploy ke Server Sendiri".
```

- [ ] **Step 2: Replace the README's `## Deploy (Self-Host)` section**

Replace the entire existing section (from `## Deploy (Self-Host)` through the `### Checklist keamanan` block, i.e. current lines 104–144) with:

```markdown
## Deploy ke Server Sendiri (VPS)

Aplikasi berjalan lewat Docker Compose: Postgres, Mosquitto, Adminer, aplikasi
Next.js yang di-containerize, dan Caddy sebagai reverse proxy/TLS terminator.
Caddy otomatis mengurus sertifikat Let's Encrypt untuk `APP_DOMAIN`, dan juga
untuk `MQTT_DOMAIN` (dipakai listener TLS Mosquitto lewat
`scripts/sync-mqtt-cert.sh`).

### 1. Sekali saja: setup server

1. Clone repo ke server, mis. `/opt/pelletq`.
2. Buat `.env` mengikuti checklist di `.env.example` — termasuk
   `POSTGRES_PASSWORD`, `AUTH_SECRET`, `SEED_ADMIN_PASSWORD`,
   `MQTT_USERNAME`/`MQTT_PASSWORD`, `APP_DOMAIN`, `MQTT_DOMAIN`.
3. Arahkan DNS `APP_DOMAIN` dan `MQTT_DOMAIN` (A record) ke IP server.
4. Buka firewall hanya untuk port yang dipakai:
   ```bash
   sudo ufw allow 80,443,8883/tcp
   ```
5. Generate password file Mosquitto (lihat
   `firmware/pelletq_esp32/README.md` untuk detail `mosquitto_passwd`).
6. Nyalakan semuanya:
   ```bash
   docker compose up -d
   ```
   Caddy otomatis meng-issue sertifikat TLS untuk `APP_DOMAIN` saat request
   pertama masuk.
7. Migrasi & seed database:
   ```bash
   docker compose run --rm migrate migrate deploy
   docker compose run --rm migrate db seed
   ```
8. Tarik sertifikat MQTT dari Caddy ke Mosquitto (jangan tunggu cron
   pertama, supaya port 8883 langsung aktif):
   ```bash
   MQTT_DOMAIN=<isi MQTT_DOMAIN dari .env> ./scripts/sync-mqtt-cert.sh
   ```
9. Jadwalkan sync sertifikat MQTT harian lewat cron (`crontab -e`):
   ```
   0 3 * * * cd /opt/pelletq && MQTT_DOMAIN=<isi MQTT_DOMAIN dari .env> ./scripts/sync-mqtt-cert.sh >> /var/log/pelletq-cert-sync.log 2>&1
   ```

### 2. Deploy perubahan berikutnya

```bash
./scripts/deploy.sh
```
Menjalankan `git pull`, build ulang image `app`, `docker compose up -d`, dan
`prisma migrate deploy` dalam satu perintah.

### Checklist keamanan

- [ ] `SEED_ADMIN_PASSWORD` diganti dari default `admin321`.
- [ ] `AUTH_SECRET` baru & rahasia (tidak sama dengan dev, tidak di-commit).
- [ ] `POSTGRES_PASSWORD` diganti dari default `pelletq_dev_password`.
- [ ] `MQTT_USERNAME`/`MQTT_PASSWORD` diganti dari kredensial dev.
- [ ] DNS `APP_DOMAIN`/`MQTT_DOMAIN` sudah mengarah ke server sebelum
      `docker compose up -d` (Caddy butuh ini untuk issue sertifikat).
- [ ] Firewall hanya buka 80/443/8883 — Postgres, Mosquitto plain/WS, dan
      Adminer tetap loopback-only (sudah default di `docker-compose.yml`).

### Verifikasi setelah deploy pertama

- [ ] `https://<APP_DOMAIN>/login` bisa diakses dari luar dengan sertifikat
      valid (bukan warning browser) dan proses login berhasil (redirect ke
      dashboard, bukan balik ke `/login`).
- [ ] `openssl s_client -connect <MQTT_DOMAIN>:8883` dari mesin lain (bukan
      dari server) menunjukkan sertifikat Let's Encrypt valid untuk
      `MQTT_DOMAIN`.
- [ ] Dari luar server: `nc -zv <IP_SERVER> 5432`, `nc -zv <IP_SERVER> 1883`,
      `nc -zv <IP_SERVER> 9001`, dan `nc -zv <IP_SERVER> 8081` semuanya GAGAL
      connect (harus loopback-only, bukan cuma "jalan" di localhost).
- [ ] Bench test ESP32 asli terhadap `MQTT_DOMAIN:8883` produksi (bukan
      broker lokal/bench) — desain security-hardening sudah menandai
      overhead RAM handshake TLS di board sebagai risiko yang perlu
      dites langsung, ini baru bisa dilakukan setelah broker publik ini
      hidup.
```

- [ ] **Step 3: Fix the Node.js prerequisite note**

In the `## Prasyarat` section, change:
```
- **Node.js** ≥ 20 (dites di v24)
```
to:
```
- **Node.js** ≥ 22.13 (dites di v24) — versi `pnpm` yang dipakai proyek ini
  (lihat `packageManager` di `package.json`) mensyaratkan minimal ini.
```

- [ ] **Step 4: Review the diff for consistency**

Run: `git diff README.md .env.example`
Expected: read through it once — confirm no leftover references to the old `pnpm start` / bare-metal deploy flow, and that every new env var mentioned in the README (`POSTGRES_PASSWORD`, `APP_DOMAIN`, `MQTT_DOMAIN`) is also documented in `.env.example`.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: rewrite production deployment docs for the Dockerized/Caddy flow"
```
