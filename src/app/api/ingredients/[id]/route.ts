import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/require-admin';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await req.json();

  try {
    const ingredient = await prisma.ingredient.update({
      where: { id },
      data: {
        name: body.name,
        proteinPct: body.proteinPct,
        lemakPct: body.lemakPct,
        seratKasarPct: body.seratKasarPct,
        abuPct: body.abuPct,
        kadarAirPct: body.kadarAirPct,
        karakterBahan: body.karakterBahan,
        hargaStandarPerKg: body.hargaStandarPerKg,
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
    });
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Nama bahan sudah ada.' }, { status: 409 });
    console.error('[ingredients] PUT gagal:', e);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const forbidden = requireAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const used = await prisma.formulationIngredient.findFirst({ where: { ingredientId: id } });

  if (used) {
    await prisma.ingredient.update({ where: { id }, data: { statusTersedia: false } });
    return NextResponse.json({ softDeleted: true });
  }

  await prisma.ingredient.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
