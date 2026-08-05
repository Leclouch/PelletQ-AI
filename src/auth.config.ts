import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

// Config ringan tanpa runtime Prisma — aman dijalankan di Edge runtime
// (dipakai oleh src/proxy.ts, lihat NextAuth(authConfig) di sana). Provider
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
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
