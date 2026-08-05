import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const availability = await prisma.userIngredientAvailability.findMany({
    where: { userId: session.user.id },
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ingredientId, stokKg, hargaPerKg, kondisi, bentuk } = await req.json();

  const record = await prisma.userIngredientAvailability.upsert({
    where: { userId_ingredientId: { userId: session.user.id, ingredientId } },
    update: { stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
    create: { userId: session.user.id, ingredientId, stokKg, hargaPerKg, kondisi, bentuk: bentuk ?? null },
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
