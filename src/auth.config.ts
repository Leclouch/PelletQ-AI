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
        session.user.id = token.id as string;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
