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
  kondisi: string;
  bentuk: string;
}

export interface FormData {
  fase: string;
  umur: string;
  jumlah: string;
  bobot: string;
  jenisPelet: string;
  diameter: string;
  panjang: string;
  targetProduksi: string;
  bahan: BahanItem[];
  prioritas: string;
  mode: string;
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
