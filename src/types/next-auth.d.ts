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

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
