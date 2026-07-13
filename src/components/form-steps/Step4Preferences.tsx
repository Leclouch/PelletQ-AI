import Pill from '@/components/ui/Pill';
import { FormData } from '@/lib/types';

interface Step4Props {
  form: FormData;
  onChoice: (field: string, value: string) => void;
  apiError: string | null;
}

const PRIORITAS_HINT: Record<string, string> = {
  Termurah: 'Menekan biaya semaksimal mungkin selama nutrisi tetap memenuhi SNI.',
  Seimbang: 'Kompromi terbaik antara biaya produksi dan kualitas nutrisi.',
  'Nutrisi Tinggi': 'Mengutamakan protein & mutu untuk pertumbuhan optimal.',
};

export default function Step4Preferences({ form, onChoice, apiError }: Step4Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: '#46554E', marginBottom: 8, display: 'block' }}>Prioritas Formulasi</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Termurah', 'Seimbang', 'Nutrisi Tinggi'].map(v => (
              <Pill key={v} selected={form.prioritas === v} onClick={() => onChoice('prioritas', v)}>{v}</Pill>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA69E', marginTop: 9, lineHeight: 1.4 }}>{PRIORITAS_HINT[form.prioritas]}</div>
        </div>
        <div style={{ height: 1, background: '#EFEADD' }} />
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: '#46554E', marginBottom: 8, display: 'block' }}>Mode Operasi</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Otomatis', 'Manual'].map(v => (
              <Pill key={v} selected={form.mode === v} onClick={() => onChoice('mode', v)}>{v}</Pill>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA69E', marginTop: 9, lineHeight: 1.4 }}>Otomatis: parameter mesin dihitung sistem. Manual: Anda atur sendiri di mesin.</div>
        </div>
      </div>

      <div style={{ background: '#E4F1E9', borderRadius: 18, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#15724B', marginBottom: 11 }}>Ringkasan</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { k: 'Ikan & Fase', v: `Lele Dumbo · ${form.fase}` },
            { k: 'Pelet', v: `${form.jenisPelet} · ${form.diameter}` },
            { k: 'Target Batch', v: `${form.targetProduksi || 0} kg` },
            { k: 'Bahan Baku', v: `${form.bahan.filter(b => b.ingredientId).length} bahan` },
          ].map(row => (
            <div key={row.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: '#5E6E66' }}>{row.k}</span>
              <span style={{ fontWeight: 800, color: '#1C2E27', textAlign: 'right' }}>{row.v}</span>
            </div>
          ))}
        </div>
      </div>

      {apiError && (
        <div style={{ background: '#FBE7E1', border: '1px solid #E2A593', borderRadius: 14, padding: '13px 14px', fontSize: 13, fontWeight: 600, color: '#8F3520', lineHeight: 1.4 }}>
          ⛔ {apiError}
        </div>
      )}
    </div>
  );
}
