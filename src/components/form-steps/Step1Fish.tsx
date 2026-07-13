import Pill from '@/components/ui/Pill';
import { FormData } from '@/lib/types';

interface Step1Props {
  form: FormData;
  onField: (name: keyof FormData, value: string) => void;
  onChoice: (field: string, value: string) => void;
}

const fieldBox: React.CSSProperties = { width: '100%', padding: '13px 14px', border: '1.5px solid #E2DDCE', borderRadius: 12, fontSize: 15, color: '#1C2E27', background: '#FCFBF7', fontWeight: 700 };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#46554E', marginBottom: 8, display: 'block' };

export default function Step1Fish({ form, onField, onChoice }: Step1Props) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={label}>Jenis Ikan</label>
        <select value="Lele Dumbo" onChange={() => {}} style={{ ...fieldBox }}>
          <option>Lele Dumbo</option>
        </select>
      </div>
      <div>
        <label style={label}>Fase Budidaya</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {['Benih', 'Grower', 'Finisher', 'Induk'].map(v => (
            <Pill key={v} selected={form.fase === v} onClick={() => onChoice('fase', v)}>{v}</Pill>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Umur Ikan</label>
          <div style={{ position: 'relative' }}>
            <input value={form.umur} onChange={e => onField('umur', e.target.value)} inputMode="numeric" style={{ ...fieldBox, paddingRight: 48 }} />
            <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 600, color: '#9AA69E' }}>hari</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Jumlah Ikan</label>
          <div style={{ position: 'relative' }}>
            <input value={form.jumlah} onChange={e => onField('jumlah', e.target.value)} inputMode="numeric" style={{ ...fieldBox, paddingRight: 52 }} />
            <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 600, color: '#9AA69E' }}>ekor</span>
          </div>
        </div>
      </div>
      <div>
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>Bobot Rata-rata <span style={{ fontSize: 11, fontWeight: 600, color: '#B3BCB4' }}>opsional</span></label>
        <div style={{ position: 'relative' }}>
          <input value={form.bobot} onChange={e => onField('bobot', e.target.value)} inputMode="numeric" style={{ ...fieldBox, paddingRight: 58 }} />
          <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 600, color: '#9AA69E' }}>gram</span>
        </div>
      </div>
    </div>
  );
}
