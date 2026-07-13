import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi";

// GET /api/docs — spesifikasi OpenAPI dalam JSON, dikonsumsi oleh /docs.
export async function GET() {
  return NextResponse.json(openApiSpec);
}
