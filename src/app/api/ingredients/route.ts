import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/require-admin';

export async function GET() {
  const ingredients = await prisma.ingredient.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({
    ingredients: ingredients.map(i => ({
      id: i.id,
      name: i.name,
      proteinPct: Number(i.proteinPct),
      lemakPct: Number(i.lemakPct),
      seratKasarPct: Number(i.seratKasarPct),
      abuPct: Number(i.abuPct),
      kadarAirPct: Number(i.kadarAirPct),
      karakterBahan: String(i.karakterBahan),
      hargaStandarPerKg: Number(i.hargaStandarPerKg),
      statusTersedia: i.statusTersedia,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const body = await req.json();
  const { name, proteinPct, lemakPct, seratKasarPct, abuPct, kadarAirPct, karakterBahan, hargaStandarPerKg } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Nama bahan wajib diisi.' }, { status: 400 });
  }

  try {
    const ingredient = await prisma.ingredient.create({
      data: {
        name: name.trim(),
        proteinPct: proteinPct ?? 0,
        lemakPct: lemakPct ?? 0,
        seratKasarPct: seratKasarPct ?? 0,
        abuPct: abuPct ?? 0,
        kadarAirPct: kadarAirPct ?? 0,
        karakterBahan: karakterBahan ?? 'NETRAL',
        hargaStandarPerKg: hargaStandarPerKg ?? 0,
        statusTersedia: true,
      },
    });
    return NextResponse.json({
      id: ingredient.id,
      name: ingredient.name,
      proteinPct: Number(ingredient.proteinPct),
      lemakPct: Number(ingredient.lemakPct),
      seratKasarPct: Number(ingredient.seratKasarPct),
      abuPct: Number(ingredient.abuPct),
      kadarAirPct: Number(ingredient.kadarAirPct),
      karakterBahan: String(ingredient.karakterBahan),
      hargaStandarPerKg: Number(ingredient.hargaStandarPerKg),
      statusTersedia: ingredient.statusTersedia,
    }, { status: 201 });
  } catch (e: any) {
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'Nama bahan sudah ada.' }, { status: 409 });
    }
    console.error('[ingredients] POST gagal:', e);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
