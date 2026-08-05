import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

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
  // Proteksi semua route KECUALI /api/auth/*, /login, asset Next.js, dan
  // file ikon (favicon.ico, icon.png, apple-icon.png) — ikon harus bisa
  // dimuat tanpa login, mis. di halaman /login itu sendiri. Route-route ini
  // juga dikecualikan secara eksplisit lewat `isPublic` di atas supaya request
  // yang lolos matcher (mis. karena prefix lain) tetap konsisten.
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
