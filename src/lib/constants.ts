import { BahanItem, FormData } from './types';

export const PHASE_MAP: Record<string, string> = { Benih: 'BENIH', Grower: 'GROWER', Finisher: 'FINISHER', Induk: 'INDUK' };
export const PELLET_MAP: Record<string, string> = { Terapung: 'TERAPUNG', Tenggelam: 'TENGGELAM' };
export const PANJANG_MAP: Record<string, string> = { Pendek: 'PENDEK', Sedang: 'SEDANG', Panjang: 'PANJANG' };
export const KONDISI_MAP: Record<string, string> = { Kering: 'KERING', 'Agak Lembap': 'AGAK_LEMBAP', Basah: 'BASAH' };
export const KONDISI_DISPLAY: Record<string, string> = { KERING: 'Kering', AGAK_LEMBAP: 'Agak Lembap', BASAH: 'Basah' };
export const BENTUK_MAP: Record<string, string> = { Halus: 'HALUS', Sedang: 'SEDANG', Kasar: 'KASAR' };
export const BENTUK_DISPLAY: Record<string, string> = { HALUS: 'Halus', SEDANG: 'Sedang', KASAR: 'Kasar' };
export const PRIORITAS_MAP: Record<string, string> = { Termurah: 'TERMURAH', Seimbang: 'SEIMBANG', 'Nutrisi Tinggi': 'NUTRISI_TINGGI' };
export const DIAMETER_MM: Record<string, number> = { '<2mm': 1.5, '2-3mm': 2.5, '3-4mm': 3.5, '>4mm': 4.5 };
export const DIAMETER_SUGGEST: Record<string, string> = { Benih: '<2mm', Grower: '2-3mm', Finisher: '3-4mm', Induk: '>4mm' };
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

export const EMPTY_BAHAN: BahanItem = { ingredientId: '', nama: '', stok: '', harga: '', kondisi: 'Kering', bentuk: 'Sedang' };

export const DEFAULT_FORM: FormData = {
  fase: 'Grower', umur: '45', jumlah: '2000', bobot: '25',
  jenisPelet: 'Terapung', diameter: '2-3mm', panjang: 'Sedang', targetProduksi: '25',
  bahan: [
    { ...EMPTY_BAHAN, kondisi: 'Kering', bentuk: 'Halus' },
    { ...EMPTY_BAHAN, kondisi: 'Kering', bentuk: 'Sedang' },
    { ...EMPTY_BAHAN, kondisi: 'Kering', bentuk: 'Sedang' },
  ],
  prioritas: 'Seimbang', mode: 'Otomatis',
};
