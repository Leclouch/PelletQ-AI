# Prompt untuk Claude Code — Lanjutkan Backend PelletQ-AI

Baca CLAUDE.md terlebih dahulu untuk konteks project.

## Tugas

Buat 5 file backend berikut. Kode di bawah sudah dirancang dan disetujui — implementasikan persis seperti ini, jangan ubah logika atau struktur. Setelah semua file dibuat, jalankan `pnpm dev` untuk verifikasi tidak ada TypeScript error.

---

## File 1: `src/lib/prisma.ts`

Prisma client singleton. Prisma 7 membutuhkan adapter di constructor.

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

---

## File 2: `src/lib/lp-solver.ts`

LP solver menggunakan library `javascript-lp-solver` (sudah terinstall). Menghitung komposisi bahan optimal dengan constraint SNI dan stok.

```typescript
import solver from "javascript-lp-solver";

// ============================================================
// TIPE DATA
// ============================================================

export interface LPIngredientInput {
  ingredientId: string;
  name: string;
  stokKg: number;
  hargaPerKg: number;
  proteinPct: number;
  lemakPct: number;
  seratKasarPct: number;
  abuPct: number;
  kadarAirPct: number;
  kondisiBahan: string;
  bentukBahan: string | null;
  karakterBahan: string;
}

export interface LPConstraints {
  proteinMinPct: number;
  lemakMinPct: number;
  seratKasarMaksPct: number;
  abuMaksPct: number;
  kadarAirMaksPct: number;
}

export interface LPResult {
  feasible: boolean;
  totalBiayaRp: number;
  ingredients: {
    ingredientId: string;
    name: string;
    jumlahKg: number;
    persentase: number;
    hargaPerKg: number;
    kondisiBahan: string;
    bentukBahan: string | null;
  }[];
  estimasi: {
    proteinPct: number;
    lemakPct: number;
    seratKasarPct: number;
    abuPct: number;
    kadarAirPct: number;
  };
}

// ============================================================
// SOLVER
// ============================================================

export function solveFormulation(
  ingredients: LPIngredientInput[],
  constraints: LPConstraints,
  targetKg: number,
  priority: "TERMURAH" | "SEIMBANG" | "NUTRISI_TINGGI"
): LPResult {
  const model: {
    optimize: string;
    opType: string;
    constraints: Record<string, { min?: number; max?: number; equal?: number }>;
    variables: Record<string, Record<string, number>>;
  } = {
    optimize: "biaya",
    opType: "min",
    constraints: {
      protein: { min: (constraints.proteinMinPct / 100) * targetKg },
      lemak: { min: (constraints.lemakMinPct / 100) * targetKg },
      seratKasar: { max: (constraints.seratKasarMaksPct / 100) * targetKg },
      abu: { max: (constraints.abuMaksPct / 100) * targetKg },
      kadarAir: { max: (constraints.kadarAirMaksPct / 100) * targetKg },
      totalBerat: { equal: targetKg },
    },
    variables: {},
  };

  // Sesuaikan constraint berdasarkan prioritas
  if (priority === "NUTRISI_TINGGI") {
    model.constraints.protein.min! *= 1.1;
  }

  // Tambahkan variabel per bahan baku
  for (const ing of ingredients) {
    const varName = `ing_${ing.ingredientId}`;

    model.constraints[`stok_${ing.ingredientId}`] = {
      max: ing.stokKg,
    };

    model.variables[varName] = {
      biaya: ing.hargaPerKg,
      protein: ing.proteinPct / 100,
      lemak: ing.lemakPct / 100,
      seratKasar: ing.seratKasarPct / 100,
      abu: ing.abuPct / 100,
      kadarAir: ing.kadarAirPct / 100,
      totalBerat: 1,
      [`stok_${ing.ingredientId}`]: 1,
    };
  }

  const result = solver.Solve(model);

  if (!result.feasible) {
    return {
      feasible: false,
      totalBiayaRp: 0,
      ingredients: [],
      estimasi: {
        proteinPct: 0,
        lemakPct: 0,
        seratKasarPct: 0,
        abuPct: 0,
        kadarAirPct: 0,
      },
    };
  }

  const usedIngredients: LPResult["ingredients"] = [];
  let totalProteinKg = 0;
  let totalLemakKg = 0;
  let totalSeratKg = 0;
  let totalAbuKg = 0;
  let totalAirKg = 0;
  let totalBiaya = 0;

  for (const ing of ingredients) {
    const varName = `ing_${ing.ingredientId}`;
    const jumlahKg = result[varName] as number | undefined;

    if (jumlahKg && jumlahKg > 0.001) {
      const qty = Math.round(jumlahKg * 1000) / 1000;

      usedIngredients.push({
        ingredientId: ing.ingredientId,
        name: ing.name,
        jumlahKg: qty,
        persentase: Math.round((qty / targetKg) * 10000) / 100,
        hargaPerKg: ing.hargaPerKg,
        kondisiBahan: ing.kondisiBahan,
        bentukBahan: ing.bentukBahan,
      });

      totalProteinKg += (ing.proteinPct / 100) * qty;
      totalLemakKg += (ing.lemakPct / 100) * qty;
      totalSeratKg += (ing.seratKasarPct / 100) * qty;
      totalAbuKg += (ing.abuPct / 100) * qty;
      totalAirKg += (ing.kadarAirPct / 100) * qty;
      totalBiaya += ing.hargaPerKg * qty;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    feasible: true,
    totalBiayaRp: Math.round(totalBiaya),
    ingredients: usedIngredients,
    estimasi: {
      proteinPct: round2((totalProteinKg / targetKg) * 100),
      lemakPct: round2((totalLemakKg / targetKg) * 100),
      seratKasarPct: round2((totalSeratKg / targetKg) * 100),
      abuPct: round2((totalAbuKg / targetKg) * 100),
      kadarAirPct: round2((totalAirKg / targetKg) * 100),
    },
  };
}
```

---

## File 3: `src/lib/sni-validator.ts`

Validasi hasil formulasi terhadap standar SNI.

```typescript
import type { LPResult } from "./lp-solver";

export interface SniLimits {
  proteinMinPct: number;
  lemakMinPct: number;
  seratKasarMaksPct: number;
  abuMaksPct: number;
  kadarAirMaksPct: number;
  diameterMinMm: number;
  diameterMaksMm: number | null;
  floatingRateMinPct: number;
}

export interface ValidationItem {
  parameter: string;
  nilai: number;
  batasSni: string;
  status: "SESUAI" | "BELUM_SESUAI";
}

export interface ValidationResult {
  statusKeseluruhan: "SESUAI" | "BELUM_SESUAI";
  items: ValidationItem[];
}

export function validateSni(
  estimasi: LPResult["estimasi"],
  diameterMm: number,
  jenisPelet: "TERAPUNG" | "TENGGELAM",
  sni: SniLimits
): ValidationResult {
  const items: ValidationItem[] = [
    {
      parameter: "Protein",
      nilai: estimasi.proteinPct,
      batasSni: `min ${sni.proteinMinPct}%`,
      status: estimasi.proteinPct >= sni.proteinMinPct ? "SESUAI" : "BELUM_SESUAI",
    },
    {
      parameter: "Lemak",
      nilai: estimasi.lemakPct,
      batasSni: `min ${sni.lemakMinPct}%`,
      status: estimasi.lemakPct >= sni.lemakMinPct ? "SESUAI" : "BELUM_SESUAI",
    },
    {
      parameter: "Serat Kasar",
      nilai: estimasi.seratKasarPct,
      batasSni: `maks ${sni.seratKasarMaksPct}%`,
      status: estimasi.seratKasarPct <= sni.seratKasarMaksPct ? "SESUAI" : "BELUM_SESUAI",
    },
    {
      parameter: "Abu",
      nilai: estimasi.abuPct,
      batasSni: `maks ${sni.abuMaksPct}%`,
      status: estimasi.abuPct <= sni.abuMaksPct ? "SESUAI" : "BELUM_SESUAI",
    },
    {
      parameter: "Kadar Air",
      nilai: estimasi.kadarAirPct,
      batasSni: `maks ${sni.kadarAirMaksPct}%`,
      status: estimasi.kadarAirPct <= sni.kadarAirMaksPct ? "SESUAI" : "BELUM_SESUAI",
    },
    {
      parameter: "Diameter Pelet",
      nilai: diameterMm,
      batasSni: sni.diameterMaksMm
        ? `${sni.diameterMinMm}–${sni.diameterMaksMm} mm`
        : `> ${sni.diameterMinMm} mm`,
      status:
        diameterMm >= sni.diameterMinMm &&
        (sni.diameterMaksMm === null || diameterMm <= sni.diameterMaksMm)
          ? "SESUAI"
          : "BELUM_SESUAI",
    },
  ];

  if (jenisPelet === "TERAPUNG") {
    items.push({
      parameter: "Floating Rate",
      nilai: sni.floatingRateMinPct,
      batasSni: `min ${sni.floatingRateMinPct}%`,
      status: "SESUAI", // Tidak bisa dihitung dari formulasi, perlu uji fisik
    });
  }

  const statusKeseluruhan = items.every((i) => i.status === "SESUAI")
    ? "SESUAI"
    : "BELUM_SESUAI";

  return { statusKeseluruhan, items };
}
```

---

## File 4: `src/lib/rule-engine.ts`

Rule-based AI untuk menentukan parameter mesin. Threshold diambil dari tabel `rule_parameters` di database.

```typescript
export interface RuleInput {
  jenisPelet: "TERAPUNG" | "TENGGELAM";
  diameterMm: number;
  panjangPelet: "PENDEK" | "SEDANG" | "PANJANG" | null;
  targetKg: number;
  kondisiBahanDominan: "KERING" | "AGAK_LEMBAP" | "BASAH";
  bentukBahanDominan: "HALUS" | "SEDANG" | "KASAR" | null;
  estimasiKadarAirPct: number;
  totalBinderPct: number;
  totalPatiPct: number;
}

export interface RuleParams {
  [key: string]: string;
}

export interface MachineOutput {
  suhuHeaterCelcius: number;
  kecepatanExtruderRpm: number;
  kecepatanPisauRpm: number;
  waktuMixingMenit: number;
  targetKadarAirAdonanPct: number;
  estimasiAirTambahanMl: number;
  urutanProses: string[];
}

export interface Warning {
  jenis: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  rekomendasi: string;
}

export interface RuleOutput {
  machineParams: MachineOutput;
  warnings: Warning[];
}

function param(params: RuleParams, key: string, fallback: number): number {
  const val = params[key];
  if (val === undefined) return fallback;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
}

export function computeMachineParams(
  input: RuleInput,
  params: RuleParams
): RuleOutput {
  const warnings: Warning[] = [];

  // 1. SUHU HEATER
  let suhuMin: number, suhuMax: number;
  if (input.jenisPelet === "TERAPUNG") {
    suhuMin = param(params, "suhu_heater_terapung_min_c", 80);
    suhuMax = param(params, "suhu_heater_terapung_max_c", 100);
  } else {
    suhuMin = param(params, "suhu_heater_tenggelam_min_c", 60);
    suhuMax = param(params, "suhu_heater_tenggelam_max_c", 80);
  }
  let suhuHeater = Math.round((suhuMin + suhuMax) / 2);
  if (input.kondisiBahanDominan === "BASAH") {
    const tambahan = param(params, "suhu_tambahan_bahan_basah_c", 10);
    suhuHeater = Math.min(suhuHeater + tambahan, suhuMax);
    warnings.push({
      jenis: "BAHAN_TERLALU_BASAH",
      severity: "WARNING",
      rekomendasi: "Bahan terlalu basah. Suhu heater dinaikkan dan extruder diperlambat. Pertimbangkan pengeringan awal.",
    });
  }

  // 2. KECEPATAN EXTRUDER
  let extruderRpm: number;
  if (input.kondisiBahanDominan === "BASAH") {
    extruderRpm = param(params, "extruder_rpm_bahan_basah", 100);
  } else if (input.kondisiBahanDominan === "AGAK_LEMBAP") {
    extruderRpm = param(params, "extruder_rpm_bahan_lembap", 130);
  } else {
    extruderRpm = param(params, "extruder_rpm_normal", 150);
  }

  // 3. KECEPATAN PISAU
  let pisauRpm: number;
  if (input.diameterMm < 2) {
    pisauRpm = param(params, "pisau_rpm_diameter_kecil", 200);
  } else if (input.diameterMm <= 3) {
    pisauRpm = param(params, "pisau_rpm_diameter_sedang", 150);
  } else if (input.diameterMm <= 4) {
    pisauRpm = param(params, "pisau_rpm_diameter_besar", 120);
  } else {
    pisauRpm = param(params, "pisau_rpm_diameter_xl", 80);
  }
  if (input.panjangPelet === "PENDEK") {
    pisauRpm = Math.round(pisauRpm * 1.2);
  } else if (input.panjangPelet === "PANJANG") {
    pisauRpm = Math.round(pisauRpm * 0.8);
  }

  // 4. WAKTU MIXING
  let mixingMenit: number;
  if (input.bentukBahanDominan === "KASAR") {
    mixingMenit = param(params, "mixing_menit_bahan_kasar", 20);
  } else if (input.bentukBahanDominan === "SEDANG") {
    mixingMenit = param(params, "mixing_menit_bahan_sedang", 15);
  } else {
    mixingMenit = param(params, "mixing_menit_bahan_halus", 10);
  }
  if (input.kondisiBahanDominan === "KERING") {
    const tambahan = param(params, "mixing_tambahan_kering_menit", 5);
    mixingMenit += tambahan;
    warnings.push({
      jenis: "BAHAN_TERLALU_KERING",
      severity: "WARNING",
      rekomendasi: "Bahan terlalu kering. Tambahkan air secukupnya dan waktu mixing diperpanjang.",
    });
  }

  // 5. TARGET KADAR AIR & ESTIMASI AIR TAMBAHAN
  const targetKadarAir = param(params, "kadar_air_adonan_target_pct", 25);
  let airTambahanMl = 0;
  if (input.estimasiKadarAirPct < targetKadarAir) {
    airTambahanMl = Math.round(
      ((targetKadarAir - input.estimasiKadarAirPct) / 100) * input.targetKg * 1000
    );
  }

  // 6. WARNINGS TAMBAHAN
  const binderMin = param(params, "binder_min_pct", 10);
  if (input.totalBinderPct < binderMin) {
    warnings.push({
      jenis: "BINDER_RENDAH",
      severity: "WARNING",
      rekomendasi: `Bahan pengikat hanya ${input.totalBinderPct.toFixed(1)}% (minimum ${binderMin}%). Tambahkan tapioka agar pelet tidak mudah hancur.`,
    });
  }
  if (input.jenisPelet === "TERAPUNG") {
    const patiMin = param(params, "pati_min_terapung_pct", 15);
    if (input.totalPatiPct < patiMin) {
      warnings.push({
        jenis: "PATI_RENDAH_PELET_TERAPUNG",
        severity: "WARNING",
        rekomendasi: `Bahan berpati hanya ${input.totalPatiPct.toFixed(1)}% (minimum ${patiMin}% untuk terapung). Tambahkan tapioka/jagung agar daya apung lebih baik.`,
      });
    }
  }
  if (input.estimasiKadarAirPct > 12) {
    warnings.push({
      jenis: "KADAR_AIR_AKHIR_TINGGI",
      severity: "CRITICAL",
      rekomendasi: "Kadar air formulasi melebihi 12% (batas SNI). Pelet harus dikeringkan hingga kadar air ≤ 12% sebelum disimpan.",
    });
  }

  // 7. URUTAN PROSES
  const urutanProses = [
    `1. Timbang bahan sesuai komposisi formulasi (total ${input.targetKg} kg).`,
    `2. Masukkan semua bahan ke dalam mixer.`,
    airTambahanMl > 0
      ? `3. Tambahkan air ±${airTambahanMl} ml secara bertahap sambil mixing.`
      : `3. Bahan sudah cukup lembap, tidak perlu tambahan air.`,
    `4. Mixing selama ${mixingMenit} menit hingga adonan homogen.`,
    `5. Alirkan adonan ke extruder (suhu heater: ${suhuHeater}°C, kecepatan: ${extruderRpm} RPM).`,
    `6. Pisau pemotong aktif pada ${pisauRpm} RPM — target diameter ±${input.diameterMm} mm.`,
    `7. Keringkan pelet basah hingga kadar air ≤ 12%.`,
    `8. Simpan pelet kering di wadah tertutup rapat.`,
  ];

  return {
    machineParams: {
      suhuHeaterCelcius: suhuHeater,
      kecepatanExtruderRpm: extruderRpm,
      kecepatanPisauRpm: pisauRpm,
      waktuMixingMenit: mixingMenit,
      targetKadarAirAdonanPct: targetKadarAir,
      estimasiAirTambahanMl: airTambahanMl,
      urutanProses,
    },
    warnings,
  };
}
```

---

## File 5: `src/app/api/formulation/route.ts`

API route utama yang menggabungkan LP solver + SNI validator + rule engine.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { solveFormulation, type LPIngredientInput } from "@/lib/lp-solver";
import { validateSni } from "@/lib/sni-validator";
import { computeMachineParams, type RuleParams } from "@/lib/rule-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      fishSpeciesId,
      phase,
      umurIkanHari,
      jumlahIkanEkor,
      bobotRataRataGram,
      jenisPelet,
      diameterPelletMm,
      panjangPelet,
      teksturTarget,
      targetProduksiKgBatch,
      bahanBaku,
      prioritas,
      modeOperasi,
      sumberDaya,
    } = body;

    // 1. Ambil standar SNI
    const sniStandard = await prisma.sniStandard.findUnique({
      where: {
        fishSpeciesId_phase: { fishSpeciesId, phase },
      },
    });

    if (!sniStandard) {
      return NextResponse.json(
        { error: "Standar SNI tidak ditemukan untuk kombinasi spesies dan fase ini." },
        { status: 404 }
      );
    }

    // 2. Ambil data nutrisi bahan baku dari database
    const ingredientIds = bahanBaku.map((b: { ingredientId: string }) => b.ingredientId);
    const dbIngredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
    });

    const lpIngredients: LPIngredientInput[] = bahanBaku.map(
      (b: {
        ingredientId: string;
        stokKg: number;
        hargaPerKg: number;
        kondisiBahan: string;
        bentukBahan: string | null;
      }) => {
        const dbIng = dbIngredients.find((d) => d.id === b.ingredientId);
        if (!dbIng) throw new Error(`Bahan ${b.ingredientId} tidak ditemukan di database.`);
        return {
          ingredientId: dbIng.id,
          name: dbIng.name,
          stokKg: b.stokKg,
          hargaPerKg: b.hargaPerKg,
          proteinPct: Number(dbIng.proteinPct),
          lemakPct: Number(dbIng.lemakPct),
          seratKasarPct: Number(dbIng.seratKasarPct),
          abuPct: Number(dbIng.abuPct),
          kadarAirPct: Number(dbIng.kadarAirPct),
          kondisiBahan: b.kondisiBahan,
          bentukBahan: b.bentukBahan,
          karakterBahan: String(dbIng.karakterBahan),
        };
      }
    );

    // 3. Jalankan LP Solver
    const lpResult = solveFormulation(
      lpIngredients,
      {
        proteinMinPct: Number(sniStandard.proteinMinPct),
        lemakMinPct: Number(sniStandard.lemakMinPct),
        seratKasarMaksPct: Number(sniStandard.seratKasarMaksPct),
        abuMaksPct: Number(sniStandard.abuMaksPct),
        kadarAirMaksPct: Number(sniStandard.kadarAirMaksPct),
      },
      targetProduksiKgBatch,
      prioritas
    );

    if (!lpResult.feasible) {
      return NextResponse.json(
        {
          error: "Formulasi tidak layak (infeasible).",
          saran: "Bahan baku yang tersedia tidak cukup untuk memenuhi standar SNI. Coba tambahkan bahan berprotein tinggi atau perbesar stok.",
        },
        { status: 422 }
      );
    }

    // 4. Validasi SNI
    const validasi = validateSni(
      lpResult.estimasi,
      diameterPelletMm,
      jenisPelet,
      {
        proteinMinPct: Number(sniStandard.proteinMinPct),
        lemakMinPct: Number(sniStandard.lemakMinPct),
        seratKasarMaksPct: Number(sniStandard.seratKasarMaksPct),
        abuMaksPct: Number(sniStandard.abuMaksPct),
        kadarAirMaksPct: Number(sniStandard.kadarAirMaksPct),
        diameterMinMm: Number(sniStandard.diameterMinMm),
        diameterMaksMm: sniStandard.diameterMaksMm ? Number(sniStandard.diameterMaksMm) : null,
        floatingRateMinPct: Number(sniStandard.floatingRateMinPct),
      }
    );

    // 5. Rule-Based AI — Parameter Mesin
    const dbRuleParams = await prisma.ruleParameter.findMany();
    const ruleParams: RuleParams = {};
    for (const rp of dbRuleParams) {
      ruleParams[rp.key] = rp.value;
    }

    const binderNames = ["Tapioka"];
    const patiNames = ["Tapioka", "Tepung Jagung"];
    let totalBinderPct = 0;
    let totalPatiPct = 0;
    for (const ing of lpResult.ingredients) {
      if (binderNames.includes(ing.name)) totalBinderPct += ing.persentase;
      if (patiNames.includes(ing.name)) totalPatiPct += ing.persentase;
    }

    const kondisiCount: Record<string, number> = {};
    const bentukCount: Record<string, number> = {};
    for (const ing of lpResult.ingredients) {
      kondisiCount[ing.kondisiBahan] = (kondisiCount[ing.kondisiBahan] || 0) + ing.jumlahKg;
      if (ing.bentukBahan) {
        bentukCount[ing.bentukBahan] = (bentukCount[ing.bentukBahan] || 0) + ing.jumlahKg;
      }
    }

    const kondisiDominan = Object.entries(kondisiCount).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] as "KERING" | "AGAK_LEMBAP" | "BASAH" || "KERING";

    const bentukDominan = Object.entries(bentukCount).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] as "HALUS" | "SEDANG" | "KASAR" | undefined || null;

    const ruleResult = computeMachineParams(
      {
        jenisPelet,
        diameterMm: diameterPelletMm,
        panjangPelet: panjangPelet || null,
        targetKg: targetProduksiKgBatch,
        kondisiBahanDominan: kondisiDominan,
        bentukBahanDominan: bentukDominan,
        estimasiKadarAirPct: lpResult.estimasi.kadarAirPct,
        totalBinderPct,
        totalPatiPct,
      },
      ruleParams
    );

    // 6. Simpan ke database
    const devUser = await prisma.user.findUnique({
      where: { email: "dev@pelletq.local" },
    });

    if (!devUser) {
      return NextResponse.json(
        { error: "User tidak ditemukan. Jalankan seed terlebih dahulu." },
        { status: 500 }
      );
    }

    const saranKoreksi = ruleResult.warnings.length > 0
      ? ruleResult.warnings.map((w) => w.rekomendasi).join(" | ")
      : null;

    const formulation = await prisma.formulation.create({
      data: {
        userId: devUser.id,
        fishSpeciesId,
        phase,
        umurIkanHari,
        jumlahIkanEkor,
        bobotRataRataGram: bobotRataRataGram || null,
        jenisPellet: jenisPelet,
        diameterPelletMm,
        panjangPelet: panjangPelet || null,
        teksturTarget: teksturTarget || null,
        targetProduksiKgBatch,
        prioritas,
        modeOperasi,
        sumberDaya: sumberDaya || null,
        totalBiayaRp: lpResult.totalBiayaRp,
        estimasiProteinPct: lpResult.estimasi.proteinPct,
        estimasiLemakPct: lpResult.estimasi.lemakPct,
        estimasiSeratPct: lpResult.estimasi.seratKasarPct,
        estimasiAbuPct: lpResult.estimasi.abuPct,
        estimasiKadarAirPct: lpResult.estimasi.kadarAirPct,
        statusSni: validasi.statusKeseluruhan,
        saranKoreksi,
        ingredients: {
          create: lpResult.ingredients.map((ing) => {
            const lpIng = lpIngredients.find((l) => l.ingredientId === ing.ingredientId)!;
            return {
              ingredientId: ing.ingredientId,
              jumlahKg: ing.jumlahKg,
              persentase: ing.persentase,
              hargaPerKgSaatItu: ing.hargaPerKg,
              kondisiBahan: ing.kondisiBahan as "KERING" | "AGAK_LEMBAP" | "BASAH",
              bentukBahan: ing.bentukBahan as "HALUS" | "SEDANG" | "KASAR" | null,
              proteinPctSaatItu: lpIng.proteinPct,
              lemakPctSaatItu: lpIng.lemakPct,
              seratKasarPctSaatItu: lpIng.seratKasarPct,
            };
          }),
        },
        machineParameter: {
          create: {
            suhuHeaterCelcius: ruleResult.machineParams.suhuHeaterCelcius,
            kecepatanExtruderRpm: ruleResult.machineParams.kecepatanExtruderRpm,
            kecepatanPisauRpm: ruleResult.machineParams.kecepatanPisauRpm,
            waktuMixingMenit: ruleResult.machineParams.waktuMixingMenit,
            targetKadarAirAdonanPct: ruleResult.machineParams.targetKadarAirAdonanPct,
            estimasiAirTambahanMl: ruleResult.machineParams.estimasiAirTambahanMl,
            urutanProses: ruleResult.machineParams.urutanProses,
          },
        },
        warnings: {
          create: ruleResult.warnings.map((w) => ({
            jenis: w.jenis as any,
            severity: w.severity as any,
            rekomendasi: w.rekomendasi,
          })),
        },
      },
      include: {
        ingredients: { include: { ingredient: true } },
        machineParameter: true,
        warnings: true,
      },
    });

    // 7. Response
    return NextResponse.json({
      formulationId: formulation.id,
      formulasi: {
        ingredients: lpResult.ingredients,
        totalBiayaRp: lpResult.totalBiayaRp,
        estimasiNutrisi: lpResult.estimasi,
      },
      validasiSni: validasi,
      parameterMesin: ruleResult.machineParams,
      peringatan: ruleResult.warnings,
    });
  } catch (error: any) {
    console.error("Formulation API error:", error);
    return NextResponse.json(
      { error: error.message || "Terjadi kesalahan pada server." },
      { status: 500 }
    );
  }
}
```

---

## Setelah semua file dibuat

1. Jalankan `pnpm dev` dan pastikan tidak ada TypeScript error.
2. Jika ada error tipe dari `javascript-lp-solver` (tidak ada type declaration), buat file `src/types/javascript-lp-solver.d.ts`:

```typescript
declare module "javascript-lp-solver" {
  interface SolverResult {
    feasible: boolean;
    result: number;
    bounded: boolean;
    isIntegral: boolean;
    [key: string]: any;
  }
  const solver: {
    Solve: (model: any) => SolverResult;
  };
  export default solver;
}
```

3. Test API dengan curl (ambil ID bahan baku dari Prisma Studio dulu):

```bash
# Ambil ingredient IDs
pnpm prisma studio
# Buka http://localhost:5555 → tabel Ingredient → catat ID-nya
```