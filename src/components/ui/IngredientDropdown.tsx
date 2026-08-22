import { IngredientOption } from '@/lib/types';

interface IngredientDropdownProps {
  ingredients: IngredientOption[];
  selectedId: string;
  selectedName: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (id: string, name: string) => void;
}

export default function IngredientDropdown({ ingredients, selectedId, selectedName, isOpen, onToggle, onSelect }: IngredientDropdownProps) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '11px 12px', border: `1.5px solid ${isOpen ? '#2563EB' : '#E2DDCE'}`, borderRadius: 11, fontSize: 14, fontWeight: 700, background: '#FCFBF7', cursor: 'pointer', color: selectedName ? '#1C2E27' : '#9AA69E', textAlign: 'left' }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedName || 'Pilih bahan…'}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA69E" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {isOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #E2DDCE', borderRadius: 13, boxShadow: '0 14px 32px rgba(28,46,39,.18)', overflow: 'hidden', maxHeight: 264, overflowY: 'auto' }}>
          {ingredients.length === 0 && (
            <div style={{ padding: '14px 13px', fontSize: 13, color: '#9AA69E', fontWeight: 600 }}>Memuat bahan baku…</div>
          )}
          {ingredients.filter(i => i.statusTersedia).map(opt => (
            <button key={opt.id} onClick={() => onSelect(opt.id, opt.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '11px 13px', fontSize: 13.5, fontWeight: selectedId === opt.id ? 800 : 600, color: selectedId === opt.id ? '#1D4ED8' : '#3A4742', background: selectedId === opt.id ? '#E1EBFB' : '#fff', cursor: 'pointer', borderBottom: '1px solid #F2EEE2' }}>
              {opt.name}
              {opt.proteinPct > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#B3BCB4', flexShrink: 0 }}>P {opt.proteinPct}%</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
