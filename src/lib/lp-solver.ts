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
