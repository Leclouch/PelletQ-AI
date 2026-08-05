# Production Security Hardening — Design

## Purpose
Get PelletQ-AI ready to expose on the public internet (VPS + Docker Compose).
Right now most API routes have **no authentication at all**, the auth
callback that's supposed to gate access is never wired up, MQTT is
unauthenticated and unencrypted, and the database port is published to the
host's public interface. This design closes those gaps and adds the baseline
hardening needed before a public launch, without expanding into a full
input-validation rewrite (explicitly out of scope — see below).

## Scope
- `middleware.ts` (new) — enforce auth on all routes by default.
- `src/app/api/ingredients/route.ts`, `src/app/api/ingredients/[id]/route.ts`,
  `src/app/api/user-ingredients/route.ts`,
  `src/app/api/user-ingredients/[id]/route.ts` — add auth checks, remove the
  `DEV_EMAIL` hardcode, add `ADMIN`-only gating on ingredient master-data
  mutations.
- `next.config.ts` — security headers.
- New rate-limit helper, applied in `middleware.ts`.
- `mosquitto/config/mosquitto.conf`, `docker-compose.yml` — TLS + auth
  listener for MQTT, stop publishing Postgres's port publicly.
- `src/lib/mqtt.ts` — MQTT username/password.
- `firmware/pelletq_esp32/pelletq_esp32.ino`,
  `firmware/pelletq_esp32/secrets.h.example` — TLS MQTT connection +
  credentials.
- `.env.example` — new MQTT credential vars, deploy checklist.

**Out of scope:** rewriting every API route's body parsing with zod schemas
(would touch every route for marginal gain here — the critical issue is
*authorization*, not payload shape); multi-instance/shared rate-limit store
(only relevant if this ever moves off a single VPS instance); switching
hosting to a PaaS.

## Design

### 1. AuthN/AuthZ enforcement
`src/auth.config.ts` already defines an `authorized()` callback written for
middleware use ("Dipakai middleware...") but no `middleware.ts` exists, so
it has never run. Add `middleware.ts` at the project root:

```ts
export { auth as middleware } from "@/auth";
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|icon.png).*)"],
};
```

Default: every route requires a session. Allowlist carved out inside
`authorized()` (already has the pattern for API vs. page routing) for:
- `/login`
- `/api/auth/*` (NextAuth's own routes — required for sign-in to work)

`/docs`, `/api/docs`, and `/test` fall under the default (session required).
If public API docs are wanted later for demo purposes, that's a one-line
addition to the allowlist — not doing it now since it wasn't asked for.

### 2. Route-level auth + the DEV_EMAIL bypass
`src/app/api/ingredients/route.ts`, `ingredients/[id]/route.ts`,
`user-ingredients/route.ts`, and `user-ingredients/[id]/route.ts` currently
call Prisma directly with no session check. Bring them in line with the
existing pattern in `formulation/route.ts`:

```ts
const session = await auth();
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

`user-ingredients/route.ts` additionally hardcodes `DEV_EMAIL =
'dev@pelletq.local'` and looks that user up on every request — meaning
every visitor currently reads and overwrites the *same* user's stock/price
data regardless of who's logged in. Replace `getDevUser()` with
`session.user.id` directly (schema already has `userId` on
`UserIngredientAvailability`). This is a correctness fix as much as a
security one.

### 3. Role-gating on ingredient master data
The `Role` enum (`ADMIN` / `MITRA`) exists on `User` but nothing checks it
anywhere. `Ingredient` is shared reference data — any authenticated user
being able to create/edit/delete it affects every other user's formulation
runs. Add a small helper:

```ts
// src/lib/require-admin.ts
export function requireAdmin(session: Session | null) {
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
```

Apply it to `POST`/`PUT`/`DELETE` in `ingredients/route.ts` and
`ingredients/[id]/route.ts`. `GET` stays open to any authenticated user.
`user-ingredients*` (a user's own stock/price availability) stays
self-service for any authenticated role — no admin gate needed there, it's
already scoped to `session.user.id`.

(Note: `session.user.role` isn't currently on the session/JWT — need to add
`role` to the `jwt()`/`session()` callbacks in `auth.config.ts` alongside the
existing `id` passthrough.)

### 4. Stop leaking internals
`ingredients/route.ts`'s `POST` catch-all currently does:
```ts
return NextResponse.json({ error: e.message }, { status: 500 });
```
This can leak Prisma internals (table/column names, query fragments) to the
client. Match the pattern already used in `formulation/route.ts`: log
server-side (`console.error`), return a generic message on 500s. Known,
expected errors (like the existing `P2002` duplicate-name case) keep their
specific, safe messages.

### 5. Security headers
Add a `headers()` function in `next.config.ts` applied to all routes:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a minimal
`Permissions-Policy`, `Strict-Transport-Security` (meaningful once behind
TLS at the VPS's reverse proxy/terminator), and a baseline
`Content-Security-Policy` (`default-src 'self'`, `script-src 'self'
'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`). The CSP intentionally
stays permissive on inline script/style rather than attempting a strict
nonce-based policy — Next.js's own hydration bootstrap needs care to avoid
silently breaking the app, and that's not verifiable without a live browser
test. Documented as a known follow-up if tighter CSP is wanted later.

### 6. Rate limiting
Single VPS instance (per your hosting choice), so an in-memory limiter is
sufficient — no Redis needed. New `src/lib/rate-limit.ts`: a per-IP sliding
window (`Map<ip, {count, windowStart}>`, cleaned up periodically). Applied
in `middleware.ts`:
- Tighter limit on `POST /api/auth/callback/credentials` (login attempts) —
  e.g. 5 per minute per IP, to blunt credential-stuffing/brute force.
- Looser general limit on `POST`/`PUT`/`DELETE` under `/api/*` — e.g. 30 per
  minute per IP.

Exceeding the limit returns `429`. This resets on process restart, which is
an accepted trade-off for a single-instance deployment.

### 7. MQTT over the internet: TLS + auth
ESP32 and the VPS are on different networks, so the broker must be reachable
over the internet — done via TLS + username/password directly on Mosquitto
(the option you picked over a firewall-only or managed-cloud-broker
approach).

`mosquitto/config/mosquitto.conf`:
```
listener 1883 127.0.0.1
allow_anonymous false
password_file /mosquitto/config/passwd

listener 8883
cafile   /mosquitto/certs/chain.pem
certfile /mosquitto/certs/fullchain.pem
keyfile  /mosquitto/certs/privkey.pem
allow_anonymous false
password_file /mosquitto/config/passwd

listener 9001
protocol websockets
allow_anonymous false
password_file /mosquitto/config/passwd
```
- `1883` bound to loopback only — used locally by the Next.js server (same
  box), not published to the internet.
- `8883` — TLS, published publicly, used by the ESP32.
- Credentials via `password_file` (generated with `mosquitto_passwd`), same
  credentials work on both listeners.
- Cert provisioning (Let's Encrypt via certbot on a subdomain pointed at the
  VPS) is an infra step you'll need to do at deploy time — not something
  scriptable from here without a live domain/server. The plan will include
  the exact commands and a renewal-hook note.

`docker-compose.yml`: publish `8883:8883`, drop the public `1883` mapping
(keep it container-internal/loopback only), mount the cert directory
read-only into the Mosquitto container.

`src/lib/mqtt.ts`: add `username`/`password` to the `mqtt.connect()` options
from new `MQTT_USERNAME`/`MQTT_PASSWORD` env vars. Keeps using
`mqtt://localhost:1883` — app and broker share the VPS, no TLS needed for
that hop.

`firmware/pelletq_esp32/pelletq_esp32.ino`: swap `WiFiClient` for
`WiFiClientSecure`, set the Let's Encrypt root CA (ISRG Root X1, embedded as
a `const char*`), and pass username/password to `mqtt.connect(...)`.
`secrets.h.example`/`secrets.h` gain `MQTT_USERNAME`/`MQTT_PASSWORD`.

**Flagging a real risk, not glossing over it:** TLS handshake RAM overhead
stacks on top of what this board already carries (TFT display + servo +
PubSubClient's existing 1024-byte buffer). This needs an actual bench test
after wiring it up — if it proves unstable, the fallback is the
managed-cloud-broker option discussed earlier, not something to silently
paper over.

### 8. Database exposure
`docker-compose.yml`'s `postgres` service currently publishes
`"5432:5432"` — on a VPS this binds to all interfaces unless the host
firewall blocks it. Change to `"127.0.0.1:5432:5432"` (or drop the mapping
entirely, since the Next.js app reaches Postgres via `DATABASE_URL` — same
host either way). No functional change for local dev.

### 9. Secrets/env checklist
`.env.example` already anticipates several prod-required secrets
(`AUTH_SECRET`, `AUTH_TRUST_HOST`, `SEED_ADMIN_PASSWORD`) with warnings
about dev defaults. Extend it with `MQTT_USERNAME`/`MQTT_PASSWORD`, and add
a short **deploy checklist** section (as a comment block or short doc) covering:
- Generate a real `AUTH_SECRET` (`openssl rand -base64 32`), don't reuse dev's.
- Set `SEED_ADMIN_PASSWORD` before running the seed in prod — don't ship
  with the `admin321` dev default.
- Generate real Postgres credentials — don't ship
  `pelletq_dev_password`.
- Generate the Mosquitto `password_file` credentials, put them in
  `MQTT_USERNAME`/`MQTT_PASSWORD`.
- Obtain the Let's Encrypt cert for the MQTT subdomain before first boot of
  the `8883` listener.

## Testing
- Manual: confirm unauthenticated requests to every previously-open route
  now get `401`; confirm a logged-in `MITRA` session gets `403` on
  ingredient-mutation routes, `200` on their own `user-ingredients`; confirm
  `ADMIN` session succeeds on ingredient mutations.
- Manual: confirm rate limiter returns `429` after exceeding thresholds, and
  resets after the window.
- Manual: `mosquitto_pub`/`mosquitto_sub` against `8883` with TLS + wrong
  credentials fails; correct credentials succeeds; anonymous/plain `1883`
  from outside the VPS fails to connect at all (loopback-only).
- Manual, on real hardware: ESP32 connects over `WiFiClientSecure` to the
  TLS listener and successfully receives a retained `pelletq/formulation`
  message; watch serial output for TLS/memory errors during a real batch
  cycle (this is the step most likely to surface the RAM-pressure risk
  flagged in section 7).
- No new automated test infra exists in this repo (no test runner
  configured) — this hardening pass doesn't introduce one; verification is
  manual per the above.
