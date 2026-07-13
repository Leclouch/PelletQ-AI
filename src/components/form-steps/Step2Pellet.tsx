import Pill from '@/components/ui/Pill';
import { FormData } from '@/lib/types';
import { DIAMETER_SUGGEST } from '@/lib/constants';

interface Step2Props {
  form: FormData;
  onField: (name: keyof FormData, value: string) => void;
  onChoice: (field: string, value: string) => void;
}

const fieldBox: React.CSSProperties = { width: '100%', padding: '13px 14px', border: '1.5px solid #E2DDCE', borderRadius: 12, fontSize: 15, color: '#1C2E27', background: '#FCFBF7', fontWeight: 700 };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#46554E', marginBottom: 8, display: 'block' };

export default function Step2Pellet({ form, onField, onChoice }: Step2Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={label}>Jenis Pelet</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Terapung', 'Tenggelam'].map(v => (
              <Pill key={v} selected={form.jenisPelet === v} onClick={() => onChoice('jenisPelet', v)}>{v}</Pill>
            ))}
          </div>
        </div>
        <div>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 7 }}>
            Diameter Pelet
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1A8A5E', background: '#E4F1E9', padding: '2px 7px', borderRadius: 999 }}>disarankan: {DIAMETER_SUGGEST[form.fase] ?? '2-3mm'}</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {['<2mm', '2-3mm', '3-4mm', '>4mm'].map(v => (
              <Pill key={v} selected={form.diameter === v} onClick={() => onChoice('diameter', v)}>{v}</Pill>
            ))}
          </div>
        </div>
        <div>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>Panjang Pelet <span style={{ fontSize: 11, fontWeight: 600, color: '#B3BCB4' }}>opsional</span></label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Pendek', 'Sedang', 'Panjang'].map(v => (
              <Pill key={v} selected={form.panjang === v} onClick={() => onChoice('panjang', v)}>{v}</Pill>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background: '#E4F1E9', border: '1.5px solid #1A8A5E', borderRadius: 18, padding: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: '#15724B', marginBottom: 8, display: 'block' }}>Target Produksi per Batch</label>
        <div style={{ position: 'relative' }}>
          <input value={form.targetProduksi} onChange={e => onField('targetProduksi', e.target.value)} inputMode="numeric" style={{ ...fieldBox, padding: '15px 50px 15px 16px', border: '1.5px solid #1A8A5E', borderRadius: 13, fontSize: 22, color: '#11623F', fontWeight: 800 }} />
          <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontSize: 15, fontWeight: 700, color: '#1A8A5E' }}>kg</span>
        </div>
      </div>
    </div>
  );
}
