import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/options — data referensi untuk mengisi form /test
// (daftar spesies + fase ber-SNI, dan daftar bahan baku).
export async function GET() {
  const species = await prisma.fishSpecies.findMany({
    select: {
      id: true,
      name: true,
      sniStandards: { select: { phase: true } },
    },
    orderBy: { name: "asc" },
  });

  const ingredients = await prisma.ingredient.findMany({
    select: {
      id: true,
      name: true,
      hargaStandarPerKg: true,
      karakterBahan: true,
      proteinPct: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    species: species.map((s) => ({
      id: s.id,
      name: s.name,
      phases: s.sniStandards.map((x) => x.phase),
    })),
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      hargaStandarPerKg: Number(i.hargaStandarPerKg),
      karakterBahan: String(i.karakterBahan),
      proteinPct: Number(i.proteinPct),
    })),
  });
}
