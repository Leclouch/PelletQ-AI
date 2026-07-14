import { NextResponse } from "next/server";
import type { NextAuthConfig } from "next-auth";

// Config ringan TANPA import Prisma — aman dijalankan di Edge runtime
// (dipakai oleh middleware.ts). Provider penuh diisi di src/auth.ts.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    // Dipakai middleware: hanya user yang sudah login boleh mengakses.
    authorized({ auth, request }) {
      if (auth?.user) return true;
      // Route API → balas 401 JSON (klien programatik butuh status, bukan
      // redirect HTML). Halaman biasa → false, Auth.js redirect ke /login.
      if (request.nextUrl.pathname.startsWith("/api")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return false;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
