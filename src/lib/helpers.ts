import { BahanItem, IngredientOption, UserIngredientAvailability } from './types';
import { EMPTY_BAHAN } from './constants';

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
export const todayStr = () => new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export const pill = (sel: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', gap: '6px', padding: '12px 8px', borderRadius: '13px',
  fontSize: '13.5px', fontWeight: sel ? 800 : 600, lineHeight: 1.15,
  cursor: 'pointer', minHeight: '48px', flex: '1 1 0', transition: 'all .14s',
  border: `1.5px solid ${sel ? '#2563EB' : '#E2DDCE'}`,
  background: sel ? '#E1EBFB' : '#FCFBF7',
  color: sel ? '#1D4ED8' : '#46554E',
  boxShadow: sel ? '0 1px 2px rgba(37,99,235,.12)' : 'none',
});

export const smallPill = (sel: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '8px 3px', borderRadius: '9px', fontSize: '11.5px',
  fontWeight: sel ? 800 : 600, lineHeight: 1.1, cursor: 'pointer',
  minHeight: '34px', flex: '1 1 0', textAlign: 'center',
  border: `1.5px solid ${sel ? '#2563EB' : '#E7E1D2'}`,
  background: sel ? '#E1EBFB' : '#FCFBF7',
  color: sel ? '#1D4ED8' : '#6B7A6F', transition: 'all .12s',
});

export function getDefaultBahan(
  userAvailability: UserIngredientAvailability[],
  ingredients: IngredientOption[],
): BahanItem[] {
  if (userAvailability.length === 0) {
    return [{ ...EMPTY_BAHAN }, { ...EMPTY_BAHAN }, { ...EMPTY_BAHAN }];
  }
  const rows = userAvailability.slice(0, 8).map((avail): BahanItem => {
    const ing = ingredients.find(i => i.id === avail.ingredientId);
    return {
      ingredientId: avail.ingredientId,
      nama: ing?.name ?? '',
      stok: String(avail.stokKg),
      harga: String(avail.hargaPerKg),
    };
  });
  // Ensure at least 3 rows
  while (rows.length < 3) rows.push({ ...EMPTY_BAHAN });
  return rows;
}
