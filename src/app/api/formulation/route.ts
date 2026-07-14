import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { solveFormulation, diagnoseInfeasibility, type LPIngredientInput } from "@/lib/lp-solver";
import { validateSni } from "@/lib/sni-validator";
import { computeMachineParams, type RuleParams } from "@/lib/rule-engine";
import { BATCH_KG, PHASE_DIAMETER_MM } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();

    const {
      fishSpeciesId,
      phase,
      umurIkanHari,
      jumlahIkanEkor,
      bobotRataRataGram,
      teksturTarget,
      targetProduksiKgBatch,
      bahanBaku,
      sumberDaya,
    } = body;

    // Nilai yang tak lagi dipilih user — dikunci sesuai kemampuan mesin.
    const jenisPelet = "TERAPUNG";
    const prioritas = "TERMURAH";
    const modeOperasi = "MANUAL";
    const panjangPelet = null;
    const diameterPelletMm = PHASE_DIAMETER_MM[phase] ?? 2.5;

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
          // Semua bahan diperlakukan kering & halus (mesin hanya menerima itu).
          kondisiBahan: "KERING",
          bentukBahan: "HALUS",
          karakterBahan: String(dbIng.karakterBahan),
        };
      }
    );

    // 3. Jalankan LP Solver
    const dbRuleParams = await prisma.ruleParameter.findMany();
    const ruleParams: RuleParams = {};
    for (const rp of dbRuleParams) {
      ruleParams[rp.key] = rp.value;
    }

    const binderMinPct = jenisPelet === "TERAPUNG" ? parseFloat(ruleParams.binder_min_pct || "0") : 0;
    const patiMinPctTerapung = jenisPelet === "TERAPUNG" ? parseFloat(ruleParams.pati_min_terapung_pct || "0") : 0;

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
      prioritas,
      binderMinPct,
      patiMinPctTerapung
    );

    if (!lpResult.feasible) {
      const diagnosa = diagnoseInfeasibility(
        lpIngredients,
        {
          proteinMinPct: Number(sniStandard.proteinMinPct),
          lemakMinPct: Number(sniStandard.lemakMinPct),
          seratKasarMaksPct: Number(sniStandard.seratKasarMaksPct),
          abuMaksPct: Number(sniStandard.abuMaksPct),
          kadarAirMaksPct: Number(sniStandard.kadarAirMaksPct),
        },
        binderMinPct,
        patiMinPctTerapung,
        targetProduksiKgBatch
      );
      return NextResponse.json(
        {
          error: "Formulasi belum memenuhi standar SNI.",
          saran: diagnosa.map((d) => d.rekomendasi).join(" "),
          diagnosa,
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
    // Definisi binder/pati selaras dengan constraint LP: binder = bahan
    // berkarakter MUDAH_MENGIKAT, pati = binder + bahan berpati (jagung)
    // yang bukan pengikat.
    const patiExtraNames = ["Tepung Jagung"];
    let totalBinderPct = 0;
    let totalPatiPct = 0;
    for (const ing of lpResult.ingredients) {
      const dbIng = dbIngredients.find((d) => d.id === ing.ingredientId);
      const isBinder = String(dbIng?.karakterBahan) === "MUDAH_MENGIKAT";
      if (isBinder) totalBinderPct += ing.persentase;
      if (isBinder || patiExtraNames.includes(ing.name)) totalPatiPct += ing.persentase;
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

    // Mesin memproses per batch 5 kg — parameter mesin (air tambahan, langkah
    // proses) dihitung untuk satu batch, bukan total produksi.
    const batchSizeKg = Math.min(targetProduksiKgBatch, BATCH_KG);

    const ruleResult = computeMachineParams(
      {
        jenisPelet,
        diameterMm: diameterPelletMm,
        panjangPelet: panjangPelet || null,
        targetKg: batchSizeKg,
        kondisiBahanDominan: kondisiDominan,
        bentukBahanDominan: bentukDominan,
        estimasiKadarAirPct: lpResult.estimasi.kadarAirPct,
        totalBinderPct,
        totalPatiPct,
      },
      ruleParams
    );

    // 6. Simpan ke database
    const saranKoreksi = ruleResult.warnings.length > 0
      ? ruleResult.warnings.map((w) => w.rekomendasi).join(" | ")
      : null;

    const formulation = await prisma.formulation.create({
      data: {
        userId,
        fishSpeciesId,
        phase,
        umurIkanHari,
        jumlahIkanEkor,
        bobotRataRataGram: bobotRataRataGram || null,
        jenisPellet: jenisPelet,
        diameterPelletMm,
        panjangPellet: panjangPelet || null,
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
    const resepPerBatch = lpResult.ingredients.map((ing) => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      persentase: ing.persentase,
      jumlahKg: Math.round((ing.persentase / 100) * batchSizeKg * 1000) / 1000,
    }));

    return NextResponse.json({
      formulationId: formulation.id,
      formulasi: {
        ingredients: lpResult.ingredients,
        totalBiayaRp: lpResult.totalBiayaRp,
        estimasiNutrisi: lpResult.estimasi,
      },
      batchInfo: {
        batchSizeKg,
        jumlahBatchPenuh: Math.floor(targetProduksiKgBatch / BATCH_KG),
        sisaKg: Math.round((targetProduksiKgBatch % BATCH_KG) * 1000) / 1000,
      },
      resepPerBatch,
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
