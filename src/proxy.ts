import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";

// Konvensi Next.js 16: file "proxy" menggantikan "middleware".
// Named export "proxy" menggantikan default export middleware.
// PENTING: tetap hanya import auth.config.ts (tanpa Prisma).
const { auth } = NextAuth(authConfig);

// Task 1 menghapus callback `authorized()` dari auth.config.ts (digantikan
// alur jwt()/session() yang membawa `role`). Akibatnya gating akses tidak lagi
// otomatis dijalankan oleh NextAuth — jadi di sini kita cek `req.auth?.user`
// secara eksplisit dan redirect/401 manual bila belum login.
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth/");

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
  // Proteksi semua route KECUALI /login, asset Next.js, dan file ikon
  // (favicon.ico, icon.png, apple-icon.png) — ikon harus bisa dimuat tanpa login,
  // mis. di halaman /login itu sendiri. /api/auth/* HARUS dimasukkan matcher
  // supaya rate limiter bisa berjalan pada login attempts. Route /login tetap
  // dikecualikan di sini dan ditangani oleh `isPublic` di dalam proxy.
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
