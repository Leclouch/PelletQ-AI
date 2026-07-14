import solverModule from "javascript-lp-solver";

// Package menyertakan type bundled yang terlalu ketat (opType literal & hasil
// Solve bertipe unknown). Longgarkan tipe agar model & indexing hasil bisa
// dipakai apa adanya, tanpa mengubah logika.
const solver = solverModule as unknown as {
  Solve: (model: unknown) => { feasible: boolean } & Record<string, number | boolean>;
};

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
  priority: "TERMURAH" | "SEIMBANG" | "NUTRISI_TINGGI",
  binderMinPct: number = 0,
  patiMinPctTerapung: number = 0
): LPResult {
  const binderIngredients: string[] = [];
  const patiIngredients: string[] = [];
  const patiNames = ["Tapioka", "Tepung Jagung"];
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

  if (binderMinPct > 0) {
    model.constraints.binder = { min: (binderMinPct / 100) * targetKg };
  }
  if (patiMinPctTerapung > 0) {
    model.constraints.patiTerapung = { min: (patiMinPctTerapung / 100) * targetKg };
  }

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

    if (binderMinPct > 0 && ing.karakterBahan === "MUDAH_MENGIKAT") {
      binderIngredients.push(varName);
      model.variables[varName].binder = 1;
    } else if (binderMinPct > 0) {
      model.variables[varName].binder = 0;
    }

    if (patiMinPctTerapung > 0 && patiNames.includes(ing.name)) {
      patiIngredients.push(varName);
      model.variables[varName].patiTerapung = 1;
    } else if (patiMinPctTerapung > 0) {
      model.variables[varName].patiTerapung = 0;
    }
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

      // Akumulasi nutrisi & biaya dari jumlah mentah (belum dibulatkan) agar
      // estimasi tepat di batas SNI — pembulatan qty hanya untuk tampilan.
      totalProteinKg += (ing.proteinPct / 100) * jumlahKg;
      totalLemakKg += (ing.lemakPct / 100) * jumlahKg;
      totalSeratKg += (ing.seratKasarPct / 100) * jumlahKg;
      totalAbuKg += (ing.abuPct / 100) * jumlahKg;
      totalAirKg += (ing.kadarAirPct / 100) * jumlahKg;
      totalBiaya += ing.hargaPerKg * jumlahKg;
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

// ============================================================
// DIAGNOSA INFEASIBLE — saran bahan yang harus ditambah/dikurangi
// ============================================================

export interface Diagnosa {
  jenis: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  rekomendasi: string;
}

const PATI_NAMES = ["Tapioka", "Tepung Jagung"];

// Cari persentase ekstrem (min/max) satu nutrisi yang bisa dicapai blend mana
// pun, hanya dibatasi total berat = target dan stok tiap bahan. Mengabaikan
// batasan nutrisi lain — jadi ini syarat perlu: bila bahkan nilai terbaik pun
// melanggar batas SNI, nutrisi itulah biang infeasible-nya.
function extremePct(
  ingredients: LPIngredientInput[],
  targetKg: number,
  coef: (ing: LPIngredientInput) => number,
  opType: "min" | "max"
): number | null {
  const model = {
    optimize: "obj",
    opType,
    constraints: { totalBerat: { equal: targetKg } } as Record<
      string,
      { min?: number; max?: number; equal?: number }
    >,
    variables: {} as Record<string, Record<string, number>>,
  };
  for (const ing of ingredients) {
    model.constraints[`stok_${ing.ingredientId}`] = { max: ing.stokKg };
    model.variables[`ing_${ing.ingredientId}`] = {
      obj: coef(ing),
      totalBerat: 1,
      [`stok_${ing.ingredientId}`]: 1,
    };
  }
  const r = solver.Solve(model);
  if (!r.feasible) return null;
  return ((r.result as number) / targetKg) * 100;
}

export function diagnoseInfeasibility(
  ingredients: LPIngredientInput[],
  constraints: LPConstraints,
  binderMinPct: number = 0,
  patiMinPctTerapung: number = 0,
  targetKg: number = 100
): Diagnosa[] {
  const out: Diagnosa[] = [];

  // 0. Total stok tidak cukup untuk memenuhi target berat.
  const totalStok = ingredients.reduce((s, i) => s + i.stokKg, 0);
  if (totalStok < targetKg - 0.001) {
    out.push({
      jenis: "STOK_KURANG",
      severity: "CRITICAL",
      rekomendasi: `Total stok bahan hanya ${totalStok.toFixed(1)} kg, kurang dari target ${targetKg} kg. Tambah stok bahan atau kurangi target produksi.`,
    });
    return out; // batasan lain tak bisa dievaluasi bila berat pun tak terpenuhi
  }

  const namaTertinggi = (coef: (ing: LPIngredientInput) => number) =>
    [...ingredients].sort((a, b) => coef(b) - coef(a))[0]?.name ?? "bahan";

  // 1. Nutrisi minimum (protein, lemak) — cek nilai maksimum yang bisa dicapai.
  const maxProtein = extremePct(ingredients, targetKg, (i) => i.proteinPct / 100, "max");
  if (maxProtein !== null && maxProtein < constraints.proteinMinPct) {
    out.push({
      jenis: "PROTEIN_KURANG",
      severity: "WARNING",
      rekomendasi: `Protein maksimum yang bisa dicapai hanya ${maxProtein.toFixed(1)}% (minimum SNI ${constraints.proteinMinPct}%). Tambahkan bahan tinggi protein seperti tepung ikan atau bungkil kedelai.`,
    });
  }
  const maxLemak = extremePct(ingredients, targetKg, (i) => i.lemakPct / 100, "max");
  if (maxLemak !== null && maxLemak < constraints.lemakMinPct) {
    out.push({
      jenis: "LEMAK_KURANG",
      severity: "WARNING",
      rekomendasi: `Lemak maksimum yang bisa dicapai hanya ${maxLemak.toFixed(1)}% (minimum SNI ${constraints.lemakMinPct}%). Tambahkan bahan berlemak seperti dedak atau minyak ikan.`,
    });
  }

  // 2. Nutrisi maksimum (serat, abu, kadar air) — cek nilai minimum yang bisa dicapai.
  const minSerat = extremePct(ingredients, targetKg, (i) => i.seratKasarPct / 100, "min");
  if (minSerat !== null && minSerat > constraints.seratKasarMaksPct) {
    out.push({
      jenis: "SERAT_BERLEBIH",
      severity: "WARNING",
      rekomendasi: `Serat kasar minimum tetap ${minSerat.toFixed(1)}% (maksimum SNI ${constraints.seratKasarMaksPct}%). Kurangi atau ganti bahan tinggi serat seperti ${namaTertinggi((i) => i.seratKasarPct)}.`,
    });
  }
  const minAbu = extremePct(ingredients, targetKg, (i) => i.abuPct / 100, "min");
  if (minAbu !== null && minAbu > constraints.abuMaksPct) {
    out.push({
      jenis: "ABU_BERLEBIH",
      severity: "WARNING",
      rekomendasi: `Kadar abu minimum tetap ${minAbu.toFixed(1)}% (maksimum SNI ${constraints.abuMaksPct}%). Kurangi bahan tinggi abu seperti ${namaTertinggi((i) => i.abuPct)}.`,
    });
  }
  const minAir = extremePct(ingredients, targetKg, (i) => i.kadarAirPct / 100, "min");
  if (minAir !== null && minAir > constraints.kadarAirMaksPct) {
    out.push({
      jenis: "KADAR_AIR_BERLEBIH",
      severity: "WARNING",
      rekomendasi: `Kadar air minimum tetap ${minAir.toFixed(1)}% (maksimum SNI ${constraints.kadarAirMaksPct}%). Keringkan atau kurangi bahan basah seperti ${namaTertinggi((i) => i.kadarAirPct)}.`,
    });
  }

  // 3. Pengikat & pati (pelet terapung).
  if (binderMinPct > 0) {
    const maxBinder = extremePct(ingredients, targetKg, (i) => (i.karakterBahan === "MUDAH_MENGIKAT" ? 1 : 0), "max");
    if (maxBinder !== null && maxBinder < binderMinPct) {
      out.push({
        jenis: "BINDER_KURANG",
        severity: "WARNING",
        rekomendasi: `Bahan pengikat maksimum ${maxBinder.toFixed(1)}% (minimum ${binderMinPct}%). Tambahkan tapioka agar pelet tidak mudah hancur.`,
      });
    }
  }
  if (patiMinPctTerapung > 0) {
    const maxPati = extremePct(ingredients, targetKg, (i) => (PATI_NAMES.includes(i.name) ? 1 : 0), "max");
    if (maxPati !== null && maxPati < patiMinPctTerapung) {
      out.push({
        jenis: "PATI_KURANG",
        severity: "WARNING",
        rekomendasi: `Bahan berpati maksimum ${maxPati.toFixed(1)}% (minimum ${patiMinPctTerapung}% untuk pelet terapung). Tambahkan tapioka atau tepung jagung.`,
      });
    }
  }

  // 4. Fallback bila tak ada batasan tunggal yang jelas melanggar (interaksi antar-batasan).
  if (out.length === 0) {
    out.push({
      jenis: "KOMBINASI_TIDAK_LAYAK",
      severity: "WARNING",
      rekomendasi: "Kombinasi bahan tidak bisa memenuhi semua batas SNI sekaligus. Tambahkan bahan tinggi protein (mis. tepung ikan) dan tapioka sebagai pengikat, lalu coba lagi.",
    });
  }

  return out;
}
