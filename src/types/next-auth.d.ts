import type { DefaultSession } from "next-auth";

// Menambahkan `id` ke Session["user"] agar `session.user.id` bertipe string.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
