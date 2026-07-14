import { BahanItem, FormData } from './types';

export const PHASE_MAP: Record<string, string> = { Benih: 'BENIH', Grower: 'GROWER', Finisher: 'FINISHER', Induk: 'INDUK' };
// Ukuran batch mesin (kg). Resep selalu disajikan per batch 5 kg.
export const BATCH_KG = 5;
// Diameter pelet (mm) diturunkan otomatis dari fase — bukan lagi pilihan user.
// Dipakai server-side (dikunci oleh enum FishPhase) untuk validasi SNI & pisau RPM.
export const PHASE_DIAMETER_MM: Record<string, number> = { BENIH: 1.5, GROWER: 2.5, FINISHER: 3.5, INDUK: 4.5 };
export const PASAR_PRICE: Record<string, number> = { Benih: 14000, Grower: 12500, Finisher: 11000, Induk: 11500 };
export const SEVERITY_STYLE: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  INFO:     { bg: '#E9EFF3', border: '#C5D4DE', text: '#3D5566', icon: 'ℹ️' },
  WARNING:  { bg: '#FBF1D9', border: '#EAC97F', text: '#825511', icon: '⚠️' },
  CRITICAL: { bg: '#FBE7E1', border: '#E2A593', text: '#8F3520', icon: '⛔' },
};
export const KARAKTER_DISPLAY: Record<string, string> = {
  MUDAH_MENGIKAT: 'Mudah Mengikat',
  SULIT_MENGIKAT: 'Sulit Mengikat',
  BERMINYAK: 'Berminyak',
  NETRAL: 'Netral',
};
export const KARAKTER_OPTIONS = ['NETRAL', 'MUDAH_MENGIKAT', 'SULIT_MENGIKAT', 'BERMINYAK'] as const;

export const EMPTY_BAHAN: BahanItem = { ingredientId: '', nama: '', stok: '', harga: '' };

export const DEFAULT_FORM: FormData = {
  fase: 'Grower', umur: '45', jumlah: '2000', bobot: '25',
  targetProduksi: '25',
  bahan: [{ ...EMPTY_BAHAN }, { ...EMPTY_BAHAN }, { ...EMPTY_BAHAN }],
};
