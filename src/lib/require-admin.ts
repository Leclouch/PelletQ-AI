import { NextResponse } from "next/server";
import type { Session } from "next-auth";

export function requireAdmin(session: Session | null): NextResponse | null {
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
