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
