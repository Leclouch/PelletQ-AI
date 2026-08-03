import AppShell from '@/components/ui/AppShell';
import StickyHeader from '@/components/ui/StickyHeader';
import StickyFooter from '@/components/ui/StickyFooter';
import { RiwayatEntry } from '@/lib/types';
import { SEVERITY_STYLE, PASAR_PRICE } from '@/lib/constants';
import { rp } from '@/lib/helpers';

interface ResultScreenProps {
  entry: RiwayatEntry;
  onBack: () => void;
}

function batchInstruksi(b: { batchSizeKg: number; jumlahBatchPenuh: number; sisaKg: number }): string {
  const parts: string[] = [];
  if (b.jumlahBatchPenuh > 0) parts.push(`Ulangi ${b.jumlahBatchPenuh}× (masing-masing ${b.batchSizeKg} kg)`);
  if (b.sisaKg > 0) parts.push(`${parts.length ? '+ ' : ''}1 batch terakhir ${b.sisaKg} kg (skala resep × ${(b.sisaKg / b.batchSizeKg).toFixed(2).replace('.', ',')})`);
  return parts.join(' ') || `1 batch ${b.batchSizeKg} kg`;
}

export default function ResultScreen({ entry, onBack }: ResultScreenProps) {
  const res = entry.result;
  const sniOk = res.validasiSni.statusKeseluruhan === 'SESUAI';
  const pasar = PASAR_PRICE[entry.fase] ?? 12500;
  const hemat = Math.max(0, pasar - entry.biayaPerKg);

  const mesinParams = [
    { label: 'Suhu Heater', val: `${res.parameterMesin.suhuHeaterCelcius} °C` },
    { label: 'Extruder', val: `${res.parameterMesin.kecepatanExtruderRpm} RPM` },
    { label: 'Pisau Pemotong', val: `${res.parameterMesin.kecepatanPisauRpm} RPM` },
    { label: 'Waktu Mixing', val: `${res.parameterMesin.waktuMixingMenit} mnt` },
    { label: 'Air Tambahan', val: `${res.parameterMesin.estimasiAirTambahanMl} ml` },
    { label: 'Target Kadar Air', val: `${res.parameterMesin.targetKadarAirAdonanPct}%` },
  ];

  return (
    <AppShell>
      <StickyHeader
        onBack={onBack}
        title={entry.nama}
        subtitle={`${entry.tanggal} · ${entry.fase} · ${entry.targetKg} kg`}
      />

      <div style={{ flex: 1, padding: '18px 18px 120px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* SNI badge */}
        <div style={{ borderRadius: 20, padding: 18, display: 'flex', alignItems: 'center', gap: 15, background: sniOk ? '#E4F1E9' : '#FBF1D9', border: `1.5px solid ${sniOk ? '#A7D4BC' : '#EAC97F'}` }}>
          <span style={{ fontSize: 32, flexShrink: 0 }}>{sniOk ? '✅' : '⚠️'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: sniOk ? '#3E8C68' : '#A6802F' }}>Status Mutu</div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.02em', color: sniOk ? '#11623F' : '#825511', lineHeight: 1.1, marginTop: 2 }}>{sniOk ? 'Sesuai SNI' : 'Belum Sesuai SNI'}</div>
          </div>
        </div>

        {/* Penjelasan AI (opsional — hanya tampil bila Gemini berhasil menjawab) */}
        {res.penjelasan && (
          <div style={{ display: 'flex', gap: 11, padding: 16, borderRadius: 18, background: '#F3EEFB', border: '1px solid #D6C6EF' }}>
            <span style={{ flexShrink: 0, fontSize: 18, lineHeight: 1.3 }}>✨</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A4E9E', marginBottom: 4 }}>Penjelasan AI</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.55, color: '#4A3B6B' }}>{res.penjelasan}</div>
            </div>
          </div>
        )}

        {/* Komposisi */}
        <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 7, height: 18, borderRadius: 4, background: '#1A8A5E' }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>Komposisi Bahan</div>
          </div>
          {res.formulasi.ingredients.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #F2EEE2' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9AA69E', marginTop: 2 }}>{it.jumlahKg.toFixed(2)} kg · {rp(it.hargaPerKg)}/kg</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#11623F' }}>{it.persentase.toFixed(1)}%</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#46554E', marginTop: 2 }}>{rp(it.jumlahKg * it.hargaPerKg)}</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 13 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800 }}>Total Produksi ({entry.targetKg} kg)</span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>{rp(res.formulasi.totalBiayaRp)}</span>
          </div>
        </div>

        {/* Resep per Batch */}
        {res.resepPerBatch && res.batchInfo && (
          <div style={{ background: '#fff', border: '1.5px solid #1A8A5E', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 7, height: 18, borderRadius: 4, background: '#1A8A5E' }} />
              <div style={{ fontSize: 16, fontWeight: 800 }}>Resep per Batch ({res.batchInfo.batchSizeKg} kg)</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#3E8C68', marginBottom: 10, lineHeight: 1.4 }}>
              {batchInstruksi(res.batchInfo)}
            </div>
            {res.resepPerBatch.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F2EEE2' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#11623F' }}>{it.jumlahKg.toFixed(2).replace('.', ',')} kg</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#9AA69E', minWidth: 42, textAlign: 'right' }}>{it.persentase.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Biaya highlight */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: 'linear-gradient(135deg,#1A8A5E 0%,#11623F 100%)', borderRadius: 18, padding: 16, color: '#fff', boxShadow: '0 6px 16px rgba(17,98,63,.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: '.05em' }}>Biaya / kg</div>
            <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1 }}>{rp(entry.biayaPerKg)}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9AA69E', textTransform: 'uppercase', letterSpacing: '.05em' }}>Hemat vs pasar</div>
            <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1, color: '#15724B' }}>{rp(hemat)}<span style={{ fontSize: 13, color: '#9AA69E', fontWeight: 700 }}>/kg</span></div>
          </div>
        </div>

        {/* Parameter Mesin */}
        <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 7, height: 18, borderRadius: 4, background: '#2D6E97' }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>Parameter Mesin</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {mesinParams.map(m => (
              <div key={m.label} style={{ background: '#E7EFF4', borderRadius: 13, padding: 13 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#5E6E66' }}>{m.label}</div>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', marginTop: 4 }}>{m.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Validasi SNI */}
        <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 7, height: 18, borderRadius: 4, background: '#C99A3A' }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>Validasi SNI</div>
          </div>
          {res.validasiSni.items.map(n => (
            <div key={n.parameter} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #F2EEE2' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{n.parameter}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800, minWidth: 64, textAlign: 'right' }}>{n.nilai.toFixed(2).replace('.', ',')} {n.parameter === 'Diameter Pelet' ? 'mm' : '%'}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 9px', borderRadius: 999, background: n.status === 'SESUAI' ? '#E2F1E7' : '#FBE7E1', color: n.status === 'SESUAI' ? '#15724B' : '#9E3D27', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {n.status === 'SESUAI' ? '✓' : '✕'} {n.batasSni}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Peringatan */}
        {res.peringatan.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {res.peringatan.map((p, i) => {
              const s = SEVERITY_STYLE[p.severity] ?? SEVERITY_STYLE.INFO;
              return (
                <div key={i} style={{ display: 'flex', gap: 11, padding: 14, borderRadius: 15, background: s.bg, border: `1px solid ${s.border}` }}>
                  <span style={{ flexShrink: 0, fontSize: 16, lineHeight: 1.3 }}>{s.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: s.text }}>{p.rekomendasi}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Langkah Produksi */}
        <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 7, height: 18, borderRadius: 4, background: '#11623F' }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>Langkah Produksi</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {res.parameterMesin.urutanProses.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, width: 25, height: 25, borderRadius: 8, background: '#E4F1E9', color: '#15724B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, color: '#3A4742', paddingTop: 2 }}>{step.replace(/^\d+\.\s*/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <StickyFooter>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px 20px', borderRadius: 14, background: '#fff', border: '1.5px solid #E2DDCE', color: '#46554E', fontSize: 15, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>Beranda</button>
        <button disabled style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 15, borderRadius: 14, background: '#E8E2D4', color: '#A6AFA7', fontSize: 15.5, fontWeight: 800, cursor: 'not-allowed', position: 'relative' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          Kirim ke Mesin
          <span style={{ position: 'absolute', top: -9, right: 12, fontSize: 9.5, fontWeight: 800, background: '#C99A3A', color: '#fff', padding: '2px 7px', borderRadius: 999, letterSpacing: '.03em' }}>SEGERA</span>
        </button>
      </StickyFooter>
    </AppShell>
  );
}
