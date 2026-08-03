export type Screen = 'dashboard' | 'form' | 'result' | 'ingredients';

export interface IngredientOption {
  id: string;
  name: string;
  proteinPct: number;
  lemakPct: number;
  seratKasarPct: number;
  abuPct: number;
  kadarAirPct: number;
  karakterBahan: string;
  hargaStandarPerKg: number;
  statusTersedia: boolean;
}

export interface UserIngredientAvailability {
  id: string;
  ingredientId: string;
  stokKg: number;
  hargaPerKg: number;
  kondisi: string;
  bentuk: string | null;
  updatedAt: string;
}

export interface BahanItem {
  ingredientId: string;
  nama: string;
  stok: string;
  harga: string;
}

export interface FormData {
  fase: string;
  umur: string;
  jumlah: string;
  bobot: string;
  targetProduksi: string;
  bahan: BahanItem[];
}

export interface ApiResult {
  formulationId: string;
  formulasi: {
    ingredients: Array<{
      ingredientId: string;
      name: string;
      jumlahKg: number;
      persentase: number;
      hargaPerKg: number;
    }>;
    totalBiayaRp: number;
    estimasiNutrisi: {
      proteinPct: number;
      lemakPct: number;
      seratKasarPct: number;
      abuPct: number;
      kadarAirPct: number;
    };
  };
  batchInfo: {
    batchSizeKg: number;
    jumlahBatchPenuh: number;
    sisaKg: number;
  };
  resepPerBatch: Array<{
    ingredientId: string;
    name: string;
    jumlahKg: number;
    persentase: number;
  }>;
  validasiSni: {
    statusKeseluruhan: 'SESUAI' | 'BELUM_SESUAI';
    items: Array<{
      parameter: string;
      nilai: number;
      batasSni: string;
      status: 'SESUAI' | 'BELUM_SESUAI';
    }>;
  };
  parameterMesin: {
    suhuHeaterCelcius: number;
    kecepatanExtruderRpm: number;
    kecepatanPisauRpm: number;
    waktuMixingMenit: number;
    targetKadarAirAdonanPct: number;
    estimasiAirTambahanMl: number;
    urutanProses: string[];
  };
  peringatan: Array<{
    jenis: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    rekomendasi: string;
  }>;
  penjelasan: string | null;
}

export interface Diagnosa {
  jenis: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  rekomendasi: string;
}

export interface RiwayatEntry {
  id: string;
  nama: string;
  tanggal: string;
  fase: string;
  targetKg: number;
  totalBiayaRp: number;
  biayaPerKg: number;
  sniOk: boolean;
  result: ApiResult;
}
