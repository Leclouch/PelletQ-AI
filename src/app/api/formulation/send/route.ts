import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { publishRetained } from "@/lib/mqtt";

// Endpoint untuk tombol "Kirim ke Mesin" — re-publish data formulasi (yang
// sudah dihitung sebelumnya, dari layar hasil atau riwayat) ke topik MQTT
// retained "pelletq/formulation". TIDAK mengirim command apa pun (start/open/
// close/reset) — hanya data resep, sama seperti publish otomatis di
// /api/formulation saat formulasi pertama kali dihitung.
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchInfo, resepPerBatch } = await req.json();

    if (
      !batchInfo ||
      typeof batchInfo.batchSizeKg !== "number" ||
      typeof batchInfo.jumlahBatchPenuh !== "number" ||
      typeof batchInfo.sisaKg !== "number" ||
      !Array.isArray(resepPerBatch)
    ) {
      return NextResponse.json({ error: "Payload formulasi tidak valid." }, { status: 400 });
    }

    await publishRetained("pelletq/formulation", {
      batchSizeKg: batchInfo.batchSizeKg,
      totalBatches: batchInfo.jumlahBatchPenuh + (batchInfo.sisaKg > 0 ? 1 : 0),
      lastBatchKg: batchInfo.sisaKg,
      ingredients: resepPerBatch.map((r: { name: string; jumlahKg: number }) => ({
        name: r.name,
        kg: r.jumlahKg,
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
