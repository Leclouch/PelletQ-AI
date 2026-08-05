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
