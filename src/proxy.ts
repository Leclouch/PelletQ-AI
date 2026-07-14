import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Konvensi Next.js 16: file "proxy" menggantikan "middleware".
// Named export "proxy" menggantikan default export middleware.
// PENTING: tetap hanya import auth.config.ts (tanpa Prisma).
export const proxy = NextAuth(authConfig).auth;

export const config = {
  // Proteksi semua route KECUALI /api/auth/*, /login, asset Next.js, dan
  // file ikon (favicon.ico, icon.png, apple-icon.png) — ikon harus bisa
  // dimuat tanpa login, mis. di halaman /login itu sendiri.
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
