import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { publishRetained } from "@/lib/mqtt";

// Endpoint untuk tombol "Kirim ke Mesin" — re-publish data formulasi (yang
// sudah dihitung sebelumnya, dari layar hasil atau riwayat) ke topik MQTT
// retained "pelletq/formulation". TIDAK mengirim command apa pun (open/close)
// — hanya data resep, sama seperti publish otomatis di /api/formulation saat
// formulasi pertama kali dihitung. kg per ingridien = TOTAL formulasi (bukan
// per batch — ESP32 tidak lagi punya konsep batch).
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ingredients } = await req.json();

    if (
      !Array.isArray(ingredients) ||
      ingredients.some(
        (i) => typeof i?.name !== "string" || typeof i?.jumlahKg !== "number"
      )
    ) {
      return NextResponse.json({ error: "Payload formulasi tidak valid." }, { status: 400 });
    }

    await publishRetained("pelletq/formulation", {
      ingredients: ingredients.map((i: { name: string; jumlahKg: number }) => ({
        name: i.name,
        kg: i.jumlahKg,
      })),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[formulation/send] MQTT publish gagal:", error);
    return NextResponse.json(
      { error: "Gagal mengirim formulasi ke mesin. Pastikan broker MQTT aktif." },
      { status: 502 }
    );
  }
}
