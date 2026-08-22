import IngredientDropdown from '@/components/ui/IngredientDropdown';
import { FormData, IngredientOption } from '@/lib/types';

interface Step3Props {
  form: FormData;
  ingredients: IngredientOption[];
  openBahan: number | null;
  openBahanDetails: Record<number, boolean>;
  onAddBahan: () => void;
  onRemoveBahan: (idx: number) => void;
  onBahanField: (idx: number, name: string, value: string) => void;
  onSelectIngredient: (idx: number, id: string, name: string) => void;
  onToggleMenu: (idx: number | null) => void;
  onToggleDetail: (idx: number) => void;
  onCloseMenus: () => void;
}

export default function Step3Ingredients({ form, ingredients, openBahan, openBahanDetails, onAddBahan, onRemoveBahan, onBahanField, onSelectIngredient, onToggleMenu, onToggleDetail, onCloseMenus }: Step3Props) {
  const canAdd = form.bahan.length < 8;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13, position: 'relative' }}>
      {openBahan !== null && <div onClick={onCloseMenus} style={{ position: 'fixed', inset: 0, zIndex: 14 }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#46554E' }}>Bahan Baku <span style={{ color: '#B3BCB4', fontWeight: 600 }}>({form.bahan.length}/8)</span></div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9AA69E' }}>minimal 3 bahan</div>
      </div>

      {form.bahan.map((b, i) => {
        const detailOpen = openBahanDetails[i] ?? !!(b.stok || b.harga);
        const canRemove = form.bahan.length > 3;
        return (
          <div key={i} style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 16, padding: 13, boxShadow: '0 1px 2px rgba(28,46,39,.04)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 8, background: '#E1EBFB', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
              <IngredientDropdown
                ingredients={ingredients}
                selectedId={b.ingredientId}
                selectedName={b.nama}
                isOpen={openBahan === i}
                onToggle={() => onToggleMenu(openBahan === i ? null : i)}
                onSelect={(id, name) => onSelectIngredient(i, id, name)}
              />
              <button onClick={() => onToggleDetail(i)} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: '#F6F3EA', border: '1px solid #E7E1D2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C8A80" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: detailOpen ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button onClick={() => onRemoveBahan(i)} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, background: canRemove ? '#FBEDE7' : '#F1ECDF', color: canRemove ? '#C06A4E' : '#C9C2B2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canRemove ? 'pointer' : 'not-allowed' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M5 12h14" /></svg>
              </button>
            </div>

            {!detailOpen && b.nama && (
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA69E', padding: '0 2px' }}>
                {[b.stok && `${b.stok} kg`, b.harga && `Rp ${Number(b.harga).toLocaleString('id')}/kg`].filter(Boolean).join(' · ') || 'Belum diisi'}
              </div>
            )}

            {detailOpen && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input value={b.stok} onChange={e => onBahanField(i, 'stok', e.target.value)} inputMode="numeric" placeholder="Stok" style={{ width: '100%', padding: '10px 36px 10px 11px', border: '1.5px solid #E2DDCE', borderRadius: 11, fontSize: 14, color: '#1C2E27', background: '#FCFBF7', fontWeight: 700 }} />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#9AA69E' }}>kg</span>
                </div>
                <div style={{ flex: 1.3, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#9AA69E' }}>Rp</span>
                  <input value={b.harga} onChange={e => onBahanField(i, 'harga', e.target.value)} inputMode="numeric" placeholder="Harga" style={{ width: '100%', padding: '10px 32px 10px 32px', border: '1.5px solid #E2DDCE', borderRadius: 11, fontSize: 14, color: '#1C2E27', background: '#FCFBF7', fontWeight: 700 }} />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#9AA69E' }}>/kg</span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button onClick={onAddBahan} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 14, borderRadius: 14, background: '#fff', border: `1.5px dashed ${canAdd ? '#2563EB' : '#D8D2C2'}`, color: canAdd ? '#2563EB' : '#B6AF9E', fontSize: 14, fontWeight: 800, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Tambah Bahan
      </button>
    </div>
  );
}
