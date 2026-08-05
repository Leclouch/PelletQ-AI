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

// Ambil entri TERAKHIR dari X-Forwarded-For, bukan yang pertama. Reverse proxy
// tepercaya (nginx dgn proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;)
// MENAMBAHKAN IP asli klien di ujung rantai — entri sebelumnya bisa disuntik
// bebas oleh klien itu sendiri. Ambil [0] berarti mempercayai nilai yang bisa
// dipalsukan penyerang untuk melewati rate limit.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",").pop()?.trim();
  return ip || "unknown";
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
