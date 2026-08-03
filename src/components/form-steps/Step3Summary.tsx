import { FormData, Diagnosa } from '@/lib/types';
import { BATCH_KG } from '@/lib/constants';

interface Step3Props {
  form: FormData;
  onField: (name: keyof FormData, value: string) => void;
  apiError: string | null;
  diagnosa: Diagnosa[] | null;
  penjelasanGagal: string | null;
}

const SEVERITY_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  INFO: { bg: '#E9EFF3', border: '#C5D4DE', text: '#3D5566' },
  WARNING: { bg: '#FBF1D9', border: '#EAC97F', text: '#825511' },
  CRITICAL: { bg: '#FBE7E1', border: '#E2A593', text: '#8F3520' },
};

export default function Step3Summary({ form, onField, apiError, diagnosa, penjelasanGagal }: Step3Props) {
  const target = parseFloat(form.targetProduksi) || 0;
  const batchPenuh = Math.floor(target / BATCH_KG);
  const sisa = Math.round((target % BATCH_KG) * 10) / 10;
  const batchLabel = target <= 0
    ? '—'
    : [batchPenuh > 0 && `${batchPenuh} batch × ${BATCH_KG} kg`, sisa > 0 && `${sisa} kg`]
        .filter(Boolean).join(' + ');

  const bahanCount = form.bahan.filter(b => b.ingredientId).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Target produksi */}
      <div style={{ background: '#E4F1E9', border: '1.5px solid #1A8A5E', borderRadius: 18, padding: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: '#15724B', marginBottom: 8, display: 'block' }}>Target Produksi Total</label>
        <div style={{ position: 'relative' }}>
          <input value={form.targetProduksi} onChange={e => onField('targetProduksi', e.target.value)} inputMode="numeric" style={{ width: '100%', padding: '15px 50px 15px 16px', border: '1.5px solid #1A8A5E', borderRadius: 13, fontSize: 22, color: '#11623F', fontWeight: 800, background: '#FCFBF7' }} />
          <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontSize: 15, fontWeight: 700, color: '#1A8A5E' }}>kg</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#3E8C68', marginTop: 9, lineHeight: 1.4 }}>
          Mesin memproses {BATCH_KG} kg per batch. Resep akan disajikan per batch {BATCH_KG} kg{target > BATCH_KG ? ` (≈ ${batchLabel})` : ''}.
        </div>
      </div>

      {/* Ringkasan */}
      <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#15724B', marginBottom: 11 }}>Ringkasan</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { k: 'Ikan & Fase', v: `Lele Dumbo · ${form.fase}` },
            { k: 'Target Produksi', v: `${target || 0} kg` },
            { k: 'Pembagian Batch', v: batchLabel },
            { k: 'Bahan Baku', v: `${bahanCount} bahan` },
          ].map(row => (
            <div key={row.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: '#5E6E66' }}>{row.k}</span>
              <span style={{ fontWeight: 800, color: '#1C2E27', textAlign: 'right' }}>{row.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Penjelasan AI (opsional — hanya tampil bila Gemini berhasil menjawab) */}
      {penjelasanGagal && (
        <div style={{ display: 'flex', gap: 10, padding: 14, borderRadius: 15, background: '#F3EEFB', border: '1px solid #D6C6EF' }}>
          <span style={{ flexShrink: 0, fontSize: 16, lineHeight: 1.3 }}>✨</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A4E9E', marginBottom: 3 }}>Penjelasan AI</div>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: '#4A3B6B' }}>{penjelasanGagal}</div>
          </div>
        </div>
      )}

      {/* Saran perbaikan (formulasi belum sesuai SNI) */}
      {diagnosa && diagnosa.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#8F3520' }}>Formulasi belum sesuai SNI — saran perbaikan:</div>
          {diagnosa.map((d, i) => {
            const s = SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.WARNING;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: 13, borderRadius: 13, background: s.bg, border: `1px solid ${s.border}` }}>
                <span style={{ flexShrink: 0, fontSize: 15, lineHeight: 1.3 }}>💡</span>
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: s.text }}>{d.rekomendasi}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Error generik (tanpa diagnosa terstruktur) */}
      {apiError && (!diagnosa || diagnosa.length === 0) && (
        <div style={{ background: '#FBE7E1', border: '1px solid #E2A593', borderRadius: 14, padding: '13px 14px', fontSize: 13, fontWeight: 600, color: '#8F3520', lineHeight: 1.4 }}>
          ⛔ {apiError}
        </div>
      )}
    </div>
  );
}
