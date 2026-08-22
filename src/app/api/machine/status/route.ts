import { NextResponse } from "next/server";
import { getMachineStatus } from "@/lib/mqtt";

// Dipoll oleh dashboard untuk badge "Sistem Aktif" — baca status LWT retained
// ESP32 ("online"/"offline" di topik pelletq/status) tanpa memicu request
// tambahan ke ESP32 itu sendiri (cukup baca in-memory dari koneksi MQTT
// server yang sudah subscribe, lihat src/lib/mqtt.ts).
export async function GET() {
  return NextResponse.json({ status: getMachineStatus() });
}
