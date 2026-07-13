import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DEV_EMAIL = 'dev@pelletq.local';

async function getDevUser() {
  return prisma.user.findUnique({ where: { email: DEV_EMAIL } });
}

export async function GET() {
  const user = await getDevUser();
  if (!user) return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 });

  const availability = await prisma.userIngredientAvailability.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({
    availability: availability.map(a => ({
      id: a.id,
      ingredientId: a.ingredientId,
      stokKg: Number(a.stokKg),
      hargaPerKg: Number(a.hargaPerKg),
      kondisi: a.kondisi,
      bentuk: a.bentuk,
      updatedAt: a.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getDevUser();
  if (!user) return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 });

  const { ingredientId, stokKg, hargaPerKg, kondisi, bentuk } = await req.json();

  const record = await prisma.userIngredientAvailability.upsert({
    where: { userId_ingredientId: { userId: user.id, ingredientId } },
    update: { stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
    create: { userId: user.id, ingredientId, stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
  });

  return NextResponse.json({
    id: record.id,
    ingredientId: record.ingredientId,
    stokKg: Number(record.stokKg),
    hargaPerKg: Number(record.hargaPerKg),
    kondisi: record.kondisi,
    bentuk: record.bentuk,
    updatedAt: record.updatedAt.toISOString(),
  });
}
