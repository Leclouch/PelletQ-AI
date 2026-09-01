# Production Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the missing-authentication gap and add the baseline hardening needed before exposing PelletQ-AI on the public internet.

**Architecture:** Wire up a Next.js `middleware.ts` (using the existing edge-safe `authConfig`) to gate every route by default, add role-based authorization for admin-only mutations, add IP-based rate limiting, add security headers, and put MQTT behind TLS + auth so the ESP32 (on a different network than the VPS) can reach the broker safely.

**Tech Stack:** Next.js 16 (App Router) + Auth.js v5 (`next-auth`), Prisma 7, Mosquitto (Docker), PubSubClient + WiFiClientSecure (ESP32/Arduino).

## Global Constraints

- No automated test runner exists in this repo (`package.json` has no `test` script). Verification throughout this plan is manual (curl, browser, `mosquitto_pub`/`sub`, serial monitor) — this is expected, not a gap to fill in.
- Out of scope (per approved spec `docs/superpowers/specs/2026-08-05-production-security-hardening-design.md`): rewriting API route body-parsing with zod schemas; multi-instance/shared rate-limit store; switching hosting off the self-hosted VPS + Docker Compose model.
- All Indonesian-language user-facing error strings already in the codebase (e.g. `"Nama bahan sudah ada."`) must keep that convention — new error strings added by this plan follow the same language.
- Prisma `Role` enum values are `ADMIN` and `MITRA` (`prisma/schema.prisma`) — use these exact strings, not invented ones.

---

### Task 1: Propagate `role` onto the session

**Files:**
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/auth.config.ts`
- Modify: `src/auth.ts`

**Interfaces:**
- Produces: `session.user.role: "ADMIN" | "MITRA"` (via Prisma's `Role` type), available anywhere `await auth()` is called — consumed by Task 4's `requireAdmin` helper.

- [ ] **Step 1: Augment the NextAuth types with `role`**

Replace the full contents of `src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";

// Menambahkan `id` & `role` ke Session["user"] agar `session.user.id` dan
// `session.user.role` bertipe benar (dipakai requireAdmin, src/lib/require-admin.ts).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: fails on `src/auth.config.ts` (jwt/session callbacks don't set `role` yet — expected at this point, fixed in Step 3) and possibly `src/auth.ts` (authorize doesn't return `role` yet, fixed in Step 4). If it fails only on those two files for exactly this reason, that confirms the type augmentation took effect.

- [ ] **Step 3: Pass `role` through the JWT/session callbacks**

In `src/auth.config.ts`, the file currently has an `authorized()` callback that's dead code (no `middleware.ts` has ever consumed it — that's fixed in Task 2, which replaces this callback entirely rather than using it). Replace the full contents of `src/auth.config.ts`:

```ts
import type { NextAuthConfig } from "next-auth";

// Config ringan tanpa runtime Prisma — aman dijalankan di Edge runtime
// (dipakai oleh middleware.ts, lihat NextAuth(authConfig) di sana). Provider
// penuh (Credentials + bcrypt + Prisma) diisi di src/auth.ts.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 4: Return `role` from the Credentials `authorize()` call**

In `src/auth.ts`, find the `authorize` function's return statement:

```ts
        return { id: user.id, name: user.name ?? undefined };
```

Replace with:

```ts
        return { id: user.id, name: user.name ?? undefined, role: user.role };
```

- [ ] **Step 5: Verify the project type-checks clean**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/next-auth.d.ts src/auth.config.ts src/auth.ts
git commit -m "feat(auth): propagate role onto the session/JWT"
```

---

### Task 2: Enforce authentication in middleware

**Files:**
- Create: `middleware.ts` (project root, alongside `next.config.ts`)

**Interfaces:**
- Consumes: `authConfig` from `src/auth.config.ts` (Task 1).
- Produces: every request not matching the public allowlist (`/login`, `/api/auth/*`, static assets) requires a session; unauthenticated API requests get `401` JSON, unauthenticated page requests redirect to `/login`. Task 3 extends this same file to add rate limiting.

- [ ] **Step 1: Reproduce the current (broken) behavior**

Run: `pnpm dev` (in one terminal), then in another:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/ingredients
```

Expected right now: `200` — anyone can list ingredients with no session. This is the bug this task fixes.

- [ ] **Step 2: Write `middleware.ts`**

```ts
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");

  if (!isPublic && !req.auth?.user) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-icon.png|icon.png).*)",
  ],
};
```

- [ ] **Step 3: Verify unauthenticated API access is now blocked**

Restart `pnpm dev`, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/ingredients
```
Expected: `401`

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/user-ingredients
```
Expected: `401`

- [ ] **Step 4: Verify `/login` and NextAuth's own routes stay reachable**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
```
Expected: `200`

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/providers
```
Expected: `200`

- [ ] **Step 5: Verify an unauthenticated page request redirects**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
Expected: `307` (or `302`) redirect to `/login` — check with `curl -sI http://localhost:3000/ | grep -i location` to confirm the `Location` header points at `/login`.

- [ ] **Step 6: Verify a logged-in session still works end to end**

In a browser, go to `http://localhost:3000/login`, sign in with the seeded admin credentials (`SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` from `.env`, or the dev default if unset — check `prisma/seed.ts` output from your last seed run), confirm you land on the dashboard and it loads data (proves `/api/options`, `/api/ingredients` etc. work for an authenticated session, not just reject unauthenticated ones).

- [ ] **Step 7: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): enforce authentication via middleware (was never wired up)"
```

---

### Task 3: Rate limiting in middleware

**Files:**
- Create: `src/lib/rate-limit.ts`
- Modify: `middleware.ts`

**Interfaces:**
- Produces: `checkRateLimit(req: NextRequest): NextResponse | null` — returns a `429` response if the caller's IP has exceeded the limit for that route class, otherwise `null` (caller continues).
- Consumes (in `middleware.ts`): called after the auth check from Task 2, before `NextResponse.next()`.

- [ ] **Step 1: Write `src/lib/rate-limit.ts`**

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rate limiter in-memory per-IP — cukup untuk deployment single-instance
// (satu VPS via docker-compose, lihat spec). Reset saat proses restart;
// trade-off yang diterima untuk skala ini (bukan untuk multi-instance).
type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

// Sweep entri kedaluwarsa begitu Map membesar, supaya tidak tumbuh tanpa
// batas kalau banyak IP unik pernah mampir (mis. bot scan).
const SWEEP_THRESHOLD = 5000;
const MAX_WINDOW_MS = 60_000;

function hit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();

  if (buckets.size > SWEEP_THRESHOLD) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= MAX_WINDOW_MS * 2) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 5;
const WRITE_WINDOW_MS = 60_000;
const WRITE_MAX = 30;

export function checkRateLimit(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  const ip = clientIp(req);

  if (pathname === "/api/auth/callback/credentials" && req.method === "POST") {
    if (!hit(`login:${ip}`, LOGIN_WINDOW_MS, LOGIN_MAX)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan login. Coba lagi nanti." },
        { status: 429 }
      );
    }
    return null;
  }

  if (
    pathname.startsWith("/api") &&
    ["POST", "PUT", "DELETE"].includes(req.method)
  ) {
    if (!hit(`write:${ip}`, WRITE_WINDOW_MS, WRITE_MAX)) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429 }
      );
    }
  }

  return null;
}
```

- [ ] **Step 2: Wire it into `middleware.ts`**

Add the import and call in `middleware.ts`:

```ts
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");

  if (!isPublic && !req.auth?.user) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const rateLimited = checkRateLimit(req);
  if (rateLimited) return rateLimited;

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-icon.png|icon.png).*)",
  ],
};
```

- [ ] **Step 3: Verify the login rate limit trips**

With `pnpm dev` running, fire 6 rapid failed-login POSTs:

```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/callback/credentials \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=nobody&password=wrong"
done
```
Expected: first 5 return `200`/`302`-ish NextAuth response codes (rejected login, but not rate-limited), the 6th returns `429`.

- [ ] **Step 4: Verify the window resets**

Wait 60 seconds, repeat one request from Step 3. Expected: no longer `429`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts middleware.ts
git commit -m "feat(security): add per-IP rate limiting on login and write endpoints"
```

---

### Task 4: Route-level authorization fixes

**Files:**
- Create: `src/lib/require-admin.ts`
- Modify: `src/app/api/ingredients/route.ts`
- Modify: `src/app/api/ingredients/[id]/route.ts`
- Modify: `src/app/api/user-ingredients/route.ts`
- Modify: `src/app/api/user-ingredients/[id]/route.ts`

**Interfaces:**
- Produces: `requireAdmin(session: Session | null): NextResponse | null` — returns `403` if the session isn't `ADMIN`, else `null`.
- Consumes: `auth()` from `@/auth` (existing, used the same way `formulation/route.ts` already does), `session.user.role` from Task 1.

This task fixes four separate problems in these files, all uncovered during the security review:
1. No auth check at all on ingredient/user-ingredient routes (middleware from Task 2 already blocks *unauthenticated* callers, but these routes still need `auth()` calls to get `session.user.id` and to add role checks).
2. `user-ingredients/route.ts` hardcodes a `DEV_EMAIL` lookup — every visitor currently reads/writes the same "dev" user's data regardless of who's logged in.
3. `user-ingredients/[id]/route.ts`'s `DELETE` has no ownership check — any authenticated user could delete another user's availability record by ID (IDOR).
4. `ingredients/route.ts` and `ingredients/[id]/route.ts` leak raw Prisma error messages (`e.message`) to the client on `500`s.

- [ ] **Step 1: Write `src/lib/require-admin.ts`**

```ts
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

export function requireAdmin(session: Session | null): NextResponse | null {
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
```

- [ ] **Step 2: Gate ingredient master-data mutations to ADMIN, stop leaking Prisma errors**

Replace the full contents of `src/app/api/ingredients/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/require-admin';

export async function GET() {
  const ingredients = await prisma.ingredient.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({
    ingredients: ingredients.map(i => ({
      id: i.id,
      name: i.name,
      proteinPct: Number(i.proteinPct),
      lemakPct: Number(i.lemakPct),
      seratKasarPct: Number(i.seratKasarPct),
      abuPct: Number(i.abuPct),
      kadarAirPct: Number(i.kadarAirPct),
      karakterBahan: String(i.karakterBahan),
      hargaStandarPerKg: Number(i.hargaStandarPerKg),
      statusTersedia: i.statusTersedia,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const body = await req.json();
  const { name, proteinPct, lemakPct, seratKasarPct, abuPct, kadarAirPct, karakterBahan, hargaStandarPerKg } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Nama bahan wajib diisi.' }, { status: 400 });
  }

  try {
    const ingredient = await prisma.ingredient.create({
      data: {
        name: name.trim(),
        proteinPct: proteinPct ?? 0,
        lemakPct: lemakPct ?? 0,
        seratKasarPct: seratKasarPct ?? 0,
        abuPct: abuPct ?? 0,
        kadarAirPct: kadarAirPct ?? 0,
        karakterBahan: karakterBahan ?? 'NETRAL',
        hargaStandarPerKg: hargaStandarPerKg ?? 0,
        statusTersedia: true,
      },
    });
    return NextResponse.json({
      id: ingredient.id,
      name: ingredient.name,
      proteinPct: Number(ingredient.proteinPct),
      lemakPct: Number(ingredient.lemakPct),
      seratKasarPct: Number(ingredient.seratKasarPct),
      abuPct: Number(ingredient.abuPct),
      kadarAirPct: Number(ingredient.kadarAirPct),
      karakterBahan: String(ingredient.karakterBahan),
      hargaStandarPerKg: Number(ingredient.hargaStandarPerKg),
      statusTersedia: ingredient.statusTersedia,
    }, { status: 201 });
  } catch (e: any) {
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'Nama bahan sudah ada.' }, { status: 409 });
    }
    console.error('[ingredients] POST gagal:', e);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Same gating + error-leak fix on the `[id]` route**

Replace the full contents of `src/app/api/ingredients/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/require-admin';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await req.json();

  try {
    const ingredient = await prisma.ingredient.update({
      where: { id },
      data: {
        name: body.name,
        proteinPct: body.proteinPct,
        lemakPct: body.lemakPct,
        seratKasarPct: body.seratKasarPct,
        abuPct: body.abuPct,
        kadarAirPct: body.kadarAirPct,
        karakterBahan: body.karakterBahan,
        hargaStandarPerKg: body.hargaStandarPerKg,
      },
    });
    return NextResponse.json({
      id: ingredient.id,
      name: ingredient.name,
      proteinPct: Number(ingredient.proteinPct),
      lemakPct: Number(ingredient.lemakPct),
      seratKasarPct: Number(ingredient.seratKasarPct),
      abuPct: Number(ingredient.abuPct),
      kadarAirPct: Number(ingredient.kadarAirPct),
      karakterBahan: String(ingredient.karakterBahan),
      hargaStandarPerKg: Number(ingredient.hargaStandarPerKg),
      statusTersedia: ingredient.statusTersedia,
    });
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Nama bahan sudah ada.' }, { status: 409 });
    console.error('[ingredients] PUT gagal:', e);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const used = await prisma.formulationIngredient.findFirst({ where: { ingredientId: id } });

  if (used) {
    await prisma.ingredient.update({ where: { id }, data: { statusTersedia: false } });
    return NextResponse.json({ softDeleted: true });
  }

  await prisma.ingredient.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
```

- [ ] **Step 4: Remove the `DEV_EMAIL` bypass, scope to the real session user**

Replace the full contents of `src/app/api/user-ingredients/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const availability = await prisma.userIngredientAvailability.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({
    availability: availability.map(a => ({
      id: a.id,
      ingredientId: a.ingredientId,
      stokKg: Number(a.stokKg),
      hargaPerKg: Number(a.hargaPerKg),
      kondisi: a.kondisi,
      bentuk: a.bentuk,
      updatedAt: a.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ingredientId, stokKg, hargaPerKg, kondisi, bentuk } = await req.json();

  const record = await prisma.userIngredientAvailability.upsert({
    where: { userId_ingredientId: { userId: session.user.id, ingredientId } },
    update: { stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
    create: { userId: session.user.id, ingredientId, stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
  });

  return NextResponse.json({
    id: record.id,
    ingredientId: record.ingredientId,
    stokKg: Number(record.stokKg),
    hargaPerKg: Number(record.hargaPerKg),
    kondisi: record.kondisi,
    bentuk: record.bentuk,
    updatedAt: record.updatedAt.toISOString(),
  });
}
```

- [ ] **Step 5: Fix the IDOR on delete — scope by owner, not just ID**

Replace the full contents of `src/app/api/user-ingredients/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const result = await prisma.userIngredientAvailability.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Data tidak ditemukan.' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
```

- [ ] **Step 6: Verify role gating manually**

With `pnpm dev` running: log in via the browser as the seeded `ADMIN` user, open devtools → Application/Storage → copy the `authjs.session-token` (or `next-auth.session-token`) cookie value, then:

```bash
# As ADMIN — should succeed (201)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/ingredients \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=<paste admin cookie>" \
  -d '{"name":"Test Bahan QA"}'
```
Expected: `201`. Clean up afterwards by deleting `Test Bahan QA` via the UI or `DELETE /api/ingredients/<id>` with the same admin cookie.

Create a second user with role `MITRA` (e.g. via Prisma Studio or a direct `UPDATE users SET role = 'MITRA'` on a test account), log in as them, repeat the same POST with their cookie. Expected: `403`.

- [ ] **Step 7: Verify the DEV_EMAIL bypass is gone and data is per-user**

Log in as two different users (or reuse the ADMIN/MITRA pair from Step 6). For each, POST different stock data to `/api/user-ingredients`, then GET it back and confirm each user only sees their own record, not the other's.

- [ ] **Step 8: Verify the IDOR fix**

Logged in as User A, create a `user-ingredients` record, note its `id`. Log in as User B, attempt `DELETE /api/user-ingredients/<User A's id>`. Expected: `404` (not `200`/`deleted: true`). Confirm via User A's session that the record still exists.

- [ ] **Step 9: Verify error messages no longer leak internals**

```bash
curl -s -X POST http://localhost:3000/api/ingredients \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=<admin cookie>" \
  -d '{"name":"Test Bahan QA","proteinPct":"not-a-number"}'
```
Expected: a `500` with `{"error":"Terjadi kesalahan pada server."}` — not a raw Prisma validation error string. (If Prisma actually coerces the string and this succeeds instead, that's fine too — the point is *if* it errors, the message is generic; adjust the payload to force a real DB error, e.g. an invalid enum value for `karakterBahan`, if needed to trigger it.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/require-admin.ts src/app/api/ingredients/route.ts src/app/api/ingredients/\[id\]/route.ts src/app/api/user-ingredients/route.ts src/app/api/user-ingredients/\[id\]/route.ts
git commit -m "fix(api): enforce admin role on ingredient mutations, scope user-ingredients to the real session user, stop leaking Prisma errors"
```

---

### Task 5: Security headers

**Files:**
- Modify: `next.config.ts`

**Interfaces:** None (config-only, no runtime code consumes this).

- [ ] **Step 1: Reproduce the current (missing) headers**

```bash
curl -sI http://localhost:3000/ | grep -iE "x-frame-options|x-content-type-options|content-security-policy"
```
Expected: no output (none of these headers are set today).

- [ ] **Step 2: Add `headers()` to `next.config.ts`**

Replace the full contents of `next.config.ts`:

```ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
```

- [ ] **Step 3: Verify the headers are present**

Restart `pnpm dev`:

```bash
curl -sI http://localhost:3000/ | grep -iE "x-frame-options|x-content-type-options|content-security-policy|referrer-policy|permissions-policy|strict-transport-security"
```
Expected: all six headers present with the values from Step 2.

- [ ] **Step 4: Verify the app still works with the CSP applied**

Open `http://localhost:3000` in a browser, open devtools console, navigate through the form flow (Step1Fish → ingredients → result). Expected: no CSP violation errors in the console, app behaves normally. If you do see a CSP violation, note the exact directive it's violating — that's a sign the app needs an adjustment to the policy (e.g. an external font/script) not present in this plan; stop and report it rather than loosening the policy blindly.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): add baseline security headers (CSP, X-Frame-Options, HSTS, etc.)"
```

---

### Task 6: Stop publishing Postgres's port to the public interface

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:** None.

- [ ] **Step 1: Confirm current exposure**

```bash
docker compose ps postgres
```
Expected `PORTS` column shows `0.0.0.0:5432->5432/tcp` (or `:::5432->5432/tcp`) — bound to all interfaces.

- [ ] **Step 2: Bind to loopback only**

In `docker-compose.yml`, find the `postgres` service's `ports:` block:

```yaml
    ports:
      - "5432:5432"
```

Replace with:

```yaml
    ports:
      - "127.0.0.1:5432:5432"
```

- [ ] **Step 3: Verify the binding changed and the app still connects**

```bash
docker compose up -d postgres
docker compose ps postgres
```
Expected `PORTS` column now shows `127.0.0.1:5432->5432/tcp`.

```bash
pnpm exec prisma db pull --print > /dev/null && echo "DB reachable OK"
```
Expected: `DB reachable OK` (still works locally, since the app connects via `localhost:5432` which is the loopback interface — no change to `.env`/`DATABASE_URL` needed).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(infra): stop publishing Postgres port to all interfaces"
```

---

### Task 7: MQTT over TLS + auth (Mosquitto + docker-compose)

**Files:**
- Modify: `mosquitto/config/mosquitto.conf`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: broker requires username/password on all three listeners; `8883` (TLS) is the only listener reachable from outside the VPS, used by the ESP32 (Task 9); `1883` (plain) stays loopback-only, used by the Next.js server on the same box (Task 8); `9001` (websockets, currently unused by anything in this codebase) stays loopback-only too, consistent with it not being consumed yet.

This task assumes you already have (or will obtain, at actual deploy time — this can't be done from this repo/session) a domain name pointed at your VPS's public IP, e.g. `mqtt.yourdomain.com`, and a Let's Encrypt certificate for it. The steps below include the exact `certbot` command; run it on the VPS itself before starting the `8883` listener, not in local dev.

- [ ] **Step 1: Update `mosquitto/config/mosquitto.conf`**

Replace the full contents of `mosquitto/config/mosquitto.conf`:

```
listener 1883
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

persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
```

- [ ] **Step 2: Update `docker-compose.yml`'s `mosquitto` service**

Find the `mosquitto` service's `ports:` and `volumes:` blocks:

```yaml
    ports:
      - "1883:1883"   # MQTT
      - "9001:9001"   # WebSocket (untuk dashboard real-time nanti)
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - mosquitto_data:/mosquitto/data
      - mosquitto_log:/mosquitto/log
```

Replace with:

```yaml
    ports:
      - "127.0.0.1:1883:1883"   # MQTT plain — lokal only, dipakai Next.js server di host yang sama
      - "8883:8883"             # MQTT TLS — publik, dipakai ESP32 (beda jaringan dari server)
      - "127.0.0.1:9001:9001"   # WebSocket — lokal only (belum dipakai apa pun)
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/certs:/mosquitto/certs:ro
      - mosquitto_data:/mosquitto/data
      - mosquitto_log:/mosquitto/log
```

- [ ] **Step 3: Generate a local password file for dev**

```bash
mkdir -p mosquitto/certs
docker compose run --rm mosquitto mosquitto_passwd -c -b /mosquitto/config/passwd pelletq_dev "$(openssl rand -base64 18)"
cat mosquitto/config/passwd
```
Note the generated password from the command (or re-run `mosquitto_passwd -b` with a password you choose instead of the random one, if you want something memorable for local dev). This `passwd` file is server-side broker config, not a repo secret in the same sense as `secrets.h` — but don't commit it either, since it contains a bcrypt hash of a real credential you'll also put in `.env`/`secrets.h`. Add it to `.gitignore`.

- [ ] **Step 4: Add the Mosquitto passwd file to `.gitignore`**

In `.gitignore`, near the `firmware/**/secrets.h` line added previously, add:

```
mosquitto/config/passwd
```

- [ ] **Step 5: For local dev only — self-signed cert so `8883` can start without a real domain**

Local dev doesn't have a real domain/Let's Encrypt cert. Generate a throwaway self-signed cert so the container boots and you can test the plain `1883` + auth path (the TLS handshake itself won't be trusted by the ESP32's real CA check — that's expected and fine for local dev, since local dev doesn't need to validate cert authenticity, only that auth is enforced):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout mosquitto/certs/privkey.pem \
  -out mosquitto/certs/fullchain.pem \
  -subj "/CN=localhost"
cp mosquitto/certs/fullchain.pem mosquitto/certs/chain.pem
```

Add `mosquitto/certs/` to `.gitignore` (these are dev-only throwaway files; production certs come from certbot on the VPS and also shouldn't be committed):

```
mosquitto/certs/
```

- [ ] **Step 6: Restart the broker and verify anonymous access is now rejected**

```bash
docker compose up -d mosquitto
mosquitto_pub -h localhost -p 1883 -t 'pelletq/test' -m 'hello' 2>&1
```
Expected: connection refused / `Connection error: Connection Refused: not authorised.` (anonymous no longer works).

- [ ] **Step 7: Verify authenticated access works**

```bash
mosquitto_sub -h localhost -p 1883 -u pelletq_dev -P '<password from Step 3>' -t 'pelletq/#' -v &
mosquitto_pub -h localhost -p 1883 -u pelletq_dev -P '<password from Step 3>' -t 'pelletq/test' -m 'hello'
```
Expected: the subscriber prints `pelletq/test hello`. Kill the background `mosquitto_sub` afterwards.

- [ ] **Step 8: Verify the TLS listener is up (self-signed, so skip cert validation for this local check)**

```bash
mosquitto_pub -h localhost -p 8883 --cafile mosquitto/certs/chain.pem -u pelletq_dev -P '<password from Step 3>' -t 'pelletq/test' -m 'hello-tls'
```
Expected: succeeds with no error (proves the TLS listener itself is configured correctly; the ESP32's real-CA validation is tested separately in Task 9 against a real cert).

- [ ] **Step 9: Verify Postgres/Mosquitto's `docker-compose.ps` shows the expected bindings**

```bash
docker compose ps
```
Expected: `mosquitto` shows `127.0.0.1:1883->1883/tcp, 0.0.0.0:8883->8883/tcp, 127.0.0.1:9001->9001/tcp` (order may vary).

- [ ] **Step 10: Commit**

```bash
git add mosquitto/config/mosquitto.conf docker-compose.yml .gitignore
git commit -m "feat(mqtt): require TLS+auth on the public listener, keep plain/websocket listeners loopback-only"
```

**Deploy-time note (not executed here):** on the actual VPS, replace Step 5's self-signed cert with a real one:
```bash
sudo certbot certonly --standalone -d mqtt.yourdomain.com
sudo cp /etc/letsencrypt/live/mqtt.yourdomain.com/fullchain.pem mosquitto/certs/
sudo cp /etc/letsencrypt/live/mqtt.yourdomain.com/privkey.pem mosquitto/certs/
sudo cp /etc/letsencrypt/live/mqtt.yourdomain.com/chain.pem mosquitto/certs/
```
Set up certbot's renewal hook to re-copy these three files and `docker compose restart mosquitto` after each renewal (certs expire every 90 days).

---

### Task 8: Next.js MQTT client — add credentials

**Files:**
- Modify: `src/lib/mqtt.ts`
- Modify: `.env.example`
- Modify: `.env` (local dev only — not committed)

**Interfaces:**
- Consumes: `MQTT_USERNAME`/`MQTT_PASSWORD` env vars (new).

- [ ] **Step 1: Add credentials to the connect options**

In `src/lib/mqtt.ts`, find:

```ts
function createMqttClient(url: string): MqttClient {
  return mqtt.connect(url, { reconnectPeriod: 5000 });
}
```

Replace with:

```ts
function createMqttClient(url: string): MqttClient {
  return mqtt.connect(url, {
    reconnectPeriod: 5000,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  });
}
```

- [ ] **Step 2: Document the new env vars in `.env.example`**

In `.env.example`, after the existing `MQTT_BROKER_URL` line, add:

```
MQTT_USERNAME=""
MQTT_PASSWORD=""
```

- [ ] **Step 3: Set real values in local `.env`**

Add the same two keys to your local `.env` with the credentials generated in Task 7 Step 3 (`pelletq_dev` / the password you noted).

- [ ] **Step 4: Verify a formulation publish still works end to end**

With `pnpm dev` running and the Task 7 broker up, log in via the browser, submit a formulation through the UI (or `POST /api/formulation` with a valid body and session cookie). In a separate terminal:

```bash
mosquitto_sub -h localhost -p 1883 -u pelletq_dev -P '<password>' -t 'pelletq/formulation' -v
```
Expected: after submitting the formulation, this prints the retained JSON payload (`batchSizeKg`, `ingredients`, etc.) — proving the app authenticated successfully against the now-locked-down broker.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mqtt.ts .env.example
git commit -m "feat(mqtt): authenticate the Next.js MQTT client against the now-locked-down broker"
```

(`.env` itself is gitignored — nothing to commit there.)

---

### Task 9: ESP32 firmware — TLS + credentials

**Files:**
- Create: `firmware/pelletq_esp32/ca_cert.h`
- Modify: `firmware/pelletq_esp32/secrets.h.example`
- Modify: `firmware/pelletq_esp32/secrets.h` (untracked — edit directly, not committed)
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino`

**Interfaces:**
- Consumes: `MQTT_USERNAME`, `MQTT_PASSWORD` (new, from `secrets.h`), `ROOT_CA` (from `ca_cert.h`).

**Known risk (flagged in the design spec, not glossed over here):** TLS on the ESP32 adds real RAM pressure on top of the TFT display + servo + PubSubClient's existing buffer. Step 7 below is a real bench test, not a formality — if it fails or the board resets/hangs, that's a signal to fall back to the managed-cloud-broker option discussed during design, not something to work around by disabling cert validation.

- [ ] **Step 1: Create `firmware/pelletq_esp32/ca_cert.h`**

This is the Let's Encrypt ISRG Root X1 root certificate (public, not a secret — safe to commit). Fetched directly from `https://letsencrypt.org/certs/isrgrootx1.pem` and verified (sha256 `22b557a27055b33606b6559f37703928d3e4ad79f110b407d04986e1843543d1`):

```cpp
// Root CA Let's Encrypt (ISRG Root X1) — publik, aman di-commit. Dipakai
// wifiClient.setCACert() untuk verifikasi TLS ke broker MQTT publik (8883).
// Sumber: https://letsencrypt.org/certs/isrgrootx1.pem
#pragma once

const char* ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";
```

- [ ] **Step 2: Add MQTT credentials to `secrets.h.example`**

In `firmware/pelletq_esp32/secrets.h.example`, add two lines after `MQTT_PORT`:

```cpp
#define MQTT_PORT      1883
#define MQTT_USERNAME  "GANTI_USERNAME"
#define MQTT_PASSWORD  "GANTI_PASSWORD"
```

Also update the `MQTT_PORT` comment to note the TLS port used for the public listener:

```cpp
#define MQTT_BROKER    "192.168.1.100"   // domain/IP publik broker (listener TLS, lihat Task 7)
#define MQTT_PORT      8883              // listener TLS (bukan 1883 plain)
```

- [ ] **Step 3: Update your local (untracked) `secrets.h` to match**

Add the same two `#define`s to `firmware/pelletq_esp32/secrets.h`, using the `pelletq_dev` credentials from Task 7 Step 3. For local bench testing (ESP32 on the same LAN as your dev machine, hitting the self-signed-cert `8883` listener), you can keep `MQTT_PORT 8883` — the CA check will fail against the self-signed cert used in local dev (expected; the real end-to-end TLS check happens once you have a real Let's Encrypt cert deployed, per Task 7's deploy-time note).

- [ ] **Step 4: Switch to `WiFiClientSecure`**

In `pelletq_esp32.ino`, find the includes near the top:

```cpp
#include <WiFi.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <ESP32Servo.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
```

Add `WiFiClientSecure` and the two new local headers:

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <ESP32Servo.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
```

And further down, `#include "secrets.h"` stays as-is; add `ca_cert.h` right after it:

```cpp
#include "secrets.h"
#include "ca_cert.h"
```

- [ ] **Step 5: Change the client type**

Find (around line 159):

```cpp
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
```

Replace with:

```cpp
WiFiClientSecure wifiClient;
PubSubClient     mqtt(wifiClient);
```

- [ ] **Step 6: Set the CA cert and pass credentials on connect**

In `setup()`, find:

```cpp
  // MQTT
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(1024);
```

Replace with:

```cpp
  // MQTT (TLS)
  wifiClient.setCACert(ROOT_CA);
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(1024);
```

In `handleMqtt()`, find:

```cpp
      if (mqtt.connect(MQTT_CLIENT_ID, nullptr, nullptr,
                       TOPIC_STATUS, 0, true, "offline")) {
```

Replace with:

```cpp
      if (mqtt.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD,
                       TOPIC_STATUS, 0, true, "offline")) {
```

- [ ] **Step 7: Bench test on real hardware — the risk flagged above**

Flash the firmware (`pio run -t upload && pio device monitor`), power the board, and watch the serial log through a full cycle:
- Confirm `[mqtt] connecting to ...` is followed by `[mqtt] connected` (not a repeated connect-fail loop — `mqtt.state()` codes printed on failure help diagnose: `-2` is usually a TLS/network-level failure, `5` is bad credentials).
- Confirm the TFT display keeps rendering normally (a garbled/frozen display under memory pressure is the first symptom to watch for).
- Send a test formulation (`formulation <json>` bench command, or a real retained MQTT publish from the website) and confirm it's received and displayed.
- Let it run through one full IDLE→HEATING→MIXING→DISPENSING cycle without a reset/crash.

If the board resets, hangs, or the TLS connection never succeeds after confirming credentials/cert are correct, stop here and report back — the documented fallback is the managed-cloud-broker option from the design discussion, not a workaround like disabling certificate validation.

- [ ] **Step 8: Commit**

```bash
git add firmware/pelletq_esp32/ca_cert.h firmware/pelletq_esp32/secrets.h.example firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): connect to MQTT over TLS with credentials"
```

(`secrets.h` itself is gitignored — nothing to commit there.)

---

### Task 10: Deploy checklist doc

**Files:**
- Modify: `.env.example`
- Modify: `firmware/pelletq_esp32/README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add a deploy checklist block to `.env.example`**

At the top of `.env.example`, before the existing `# Database` section, add:

```
# ============================================================================
# CHECKLIST SEBELUM DEPLOY KE INTERNET (jangan skip salah satu):
#   1. DATABASE_URL: ganti password Postgres dev
#      dengan kredensial baru — update juga POSTGRES_PASSWORD di
#      docker-compose.yml.
#   2. AUTH_SECRET: generate baru, JANGAN pakai punya dev.
#      `openssl rand -base64 32`
#   3. SEED_ADMIN_PASSWORD: isi dengan password kuat sebelum
#      `pnpm prisma db seed` di server produksi — default dev ("<password-dev-lama>")
#      TIDAK boleh dipakai di produksi.
#   4. MQTT_USERNAME / MQTT_PASSWORD: generate baru via `mosquitto_passwd`
#      (lihat firmware/pelletq_esp32/README.md), bukan kredensial dev.
#   5. Sertifikat TLS Mosquitto (mosquitto/certs/): pasang cert Let's
#      Encrypt asli untuk domain broker sebelum listener 8883 dipakai
#      ESP32 — lihat catatan deploy di firmware/pelletq_esp32/README.md.
#   6. firmware secrets.h di setiap ESP32: WIFI_SSID/PASSWORD, MQTT_BROKER
#      (domain publik), MQTT_USERNAME/PASSWORD — kredensial produksi, bukan
#      bench-test.
# ============================================================================

```

- [ ] **Step 2: Cross-reference the checklist from the firmware README**

In `firmware/pelletq_esp32/README.md`, in the "Sebelum upload" section (already updated by a previous change to reference `secrets.h`), add a short pointer after the existing content:

```markdown
> Untuk deploy produksi (broker MQTT lewat internet, bukan LAN lokal), MQTT_BROKER
> harus domain publik dengan sertifikat TLS di port 8883, dan MQTT_USERNAME/
> MQTT_PASSWORD wajib diisi kredensial asli (bukan bench-test). Lihat checklist
> lengkap di `.env.example` bagian atas.
```

- [ ] **Step 3: Verify the docs read coherently**

Read through `.env.example` and the updated `firmware/pelletq_esp32/README.md` top to bottom as if you were deploying for the first time — confirm nothing references a var or file that doesn't exist after Tasks 1–9 (e.g. `MQTT_USERNAME`, `ca_cert.h`, `mosquitto/certs/`).

- [ ] **Step 4: Commit**

```bash
git add .env.example firmware/pelletq_esp32/README.md
git commit -m "docs: add pre-deploy security checklist"
```
