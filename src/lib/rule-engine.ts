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
