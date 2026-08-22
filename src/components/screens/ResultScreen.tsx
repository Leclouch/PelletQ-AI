'use client';

import { useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import StickyHeader from '@/components/ui/StickyHeader';
import StickyFooter from '@/components/ui/StickyFooter';
import Sidebar from '@/components/ui/Sidebar';
import { RiwayatEntry } from '@/lib/types';
import { SEVERITY_STYLE, PASAR_PRICE, MINYAK_IKAN_NAME, kgToMlMinyakIkan, rpPerKgToRpPerMlMinyakIkan } from '@/lib/constants';
import { rp } from '@/lib/helpers';

// Minyak Ikan ditampilkan dalam ml (bukan kg) — murni tampilan, lihat
// MINYAK_IKAN_DENSITY_KG_PER_L di lib/constants untuk asumsi densitasnya.
// Neraca massa/LP solver/DB/protokol ESP32 tetap kg apa adanya.
function fmtJumlah(name: string, jumlahKg: number): string {
  if (name === MINYAK_IKAN_NAME) return `${Math.round(kgToMlMinyakIkan(jumlahKg))} ml`;
  return `${jumlahKg.toFixed(2)} kg`;
}
function fmtHargaPerUnit(name: string, hargaPerKg: number): string {
  if (name === MINYAK_IKAN_NAME) return `${rp(rpPerKgToRpPerMlMinyakIkan(hargaPerKg))}/ml`;
  return `${rp(hargaPerKg)}/kg`;
}

interface ResultScreenProps {
  entry: RiwayatEntry;
  onBack: () => void;
  onGoIngredients: () => void;
  onStartForm: () => void;
  onGoHelp: () => void;
  onLogout: () => void;
}

function batchInstruksi(b: { batchSizeKg: number; jumlahBatchPenuh: number; sisaKg: number }): string {
  const parts: string[] = [];
  if (b.jumlahBatchPenuh > 0) parts.push(`Ulangi ${b.jumlahBatchPenuh}× (masing-masing ${b.batchSizeKg} kg)`);
  if (b.sisaKg > 0) parts.push(`${parts.length ? '+ ' : ''}1 batch terakhir ${b.sisaKg} kg (skala resep × ${(b.sisaKg / b.batchSizeKg).toFixed(2).replace('.', ',')})`);
  return parts.join(' ') || `1 batch ${b.batchSizeKg} kg`;
}

type KirimStatus = 'idle' | 'sending' | 'sent' | 'error';

export default function ResultScreen({ entry, onBack, onGoIngredients, onStartForm, onGoHelp, onLogout }: ResultScreenProps) {
  const res = entry.result;
  const sniOk = res.validasiSni.statusKeseluruhan === 'SESUAI';
  const pasar = PASAR_PRICE[entry.fase] ?? 12500;
  const hemat = Math.max(0, pasar - entry.biayaPerKg);

  const [kirimStatus, setKirimStatus] = useState<KirimStatus>('idle');

  async function kirimKeMesin() {
    setKirimStatus('sending');
    try {
      const r = await fetch('/api/formulation/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: res.formulasi.ingredients }),
      });
      if (!r.ok) throw new Error();
      setKirimStatus('sent');
    } catch {
      setKirimStatus('error');
    }
  }

  const mesinParams = [
    { label: 'Suhu Heater', val: `${res.parameterMesin.suhuHeaterCelcius} °C` },
    { label: 'Extruder', val: `${res.parameterMesin.kecepatanExtruderRpm} RPM` },
    { label: 'Pisau Pemotong', val: `${res.parameterMesin.kecepatanPisauRpm} RPM` },
    { label: 'Waktu Mixing', val: `${res.parameterMesin.waktuMixingMenit} mnt` },
    { label: 'Air Tambahan', val: `${res.parameterMesin.estimasiAirTambahanMl} ml` },
    { label: 'Target Kadar Air', val: `${res.parameterMesin.targetKadarAirAdonanPct}%` },
  ];

  // Rough estimated pixel-height per card, so the two desktop columns can be
  // balanced by weight instead of a hand-picked gridColumn per card. Order is
  // preserved within whichever column a card lands in.
  const blocks: { key: string; weight: number; node: React.ReactNode }[] = [];

  if (res.penjelasan) {
    blocks.push({
      key: 'penjelasan',
      weight: 70 + Math.ceil(res.penjelasan.length / 45) * 18,
      node: (
        <div style={{ display: 'flex', gap: 11, padding: 16, borderRadius: 18, background: '#F3EEFB', border: '1px solid #D6C6EF' }}>
          <span style={{ flexShrink: 0, fontSize: 18, lineHeight: 1.3 }}>✨</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6A4E9E', marginBottom: 4 }}>Penjelasan AI</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.55, color: '#4A3B6B' }}>{res.penjelasan}</div>
          </div>
        </div>
      ),
    });
  }

  blocks.push({
    key: 'komposisi',
    weight: 70 + res.formulasi.ingredients.length * 48,
    node: (
      <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ width: 7, height: 18, borderRadius: 4, background: '#2563EB' }} />
          <div style={{ fontSize: 16, fontWeight: 800 }}>Komposisi Bahan</div>
        </div>
        {res.formulasi.ingredients.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #F2EEE2' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9AA69E', marginTop: 2 }}>{fmtJumlah(it.name, it.jumlahKg)} · {fmtHargaPerUnit(it.name, it.hargaPerKg)}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1D4ED8' }}>{it.persentase.toFixed(1)}%</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#46554E', marginTop: 2 }}>{rp(it.jumlahKg * it.hargaPerKg)}</div>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 13 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>Total Produksi ({entry.targetKg} kg)</span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{rp(res.formulasi.totalBiayaRp)}</span>
        </div>
      </div>
    ),
  });

  if (res.resepPerBatch && res.batchInfo) {
    const resepPerBatch = res.resepPerBatch;
    const batchInfo = res.batchInfo;
    blocks.push({
      key: 'resep',
      weight: 80 + resepPerBatch.length * 44,
      node: (
        <div style={{ background: '#fff', border: '1.5px solid #2563EB', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 7, height: 18, borderRadius: 4, background: '#2563EB' }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>Resep per Batch ({batchInfo.batchSizeKg} kg)</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#3568C7', marginBottom: 10, lineHeight: 1.4 }}>
            {batchInstruksi(batchInfo)}
          </div>
          {resepPerBatch.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F2EEE2' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#1D4ED8' }}>{fmtJumlah(it.name, it.jumlahKg).replace('.', ',')}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#9AA69E', minWidth: 42, textAlign: 'right' }}>{it.persentase.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      ),
    });
  }

  blocks.push({
    key: 'biaya',
    weight: 110,
    node: (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: 'linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)', borderRadius: 18, padding: 16, color: '#fff', boxShadow: '0 6px 16px rgba(29,78,216,.2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: '.05em' }}>Biaya / kg</div>
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1 }}>{rp(entry.biayaPerKg)}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9AA69E', textTransform: 'uppercase', letterSpacing: '.05em' }}>Hemat vs pasar</div>
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', marginTop: 5, lineHeight: 1, color: '#1D4ED8' }}>{rp(hemat)}<span style={{ fontSize: 13, color: '#9AA69E', fontWeight: 700 }}>/kg</span></div>
        </div>
      </div>
    ),
  });

  blocks.push({
    key: 'parameter',
    weight: 60 + Math.ceil(mesinParams.length / 2) * 70,
    node: (
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
    ),
  });

  blocks.push({
    key: 'validasi',
    weight: 55 + res.validasiSni.items.length * 48,
    node: (
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
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 9px', borderRadius: 999, background: n.status === 'SESUAI' ? '#E1EBFB' : '#FBE7E1', color: n.status === 'SESUAI' ? '#1D4ED8' : '#9E3D27', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                {n.status === 'SESUAI' ? '✓' : '✕'} {n.batasSni}
              </span>
            </div>
          </div>
        ))}
      </div>
    ),
  });

  if (res.peringatan.length > 0) {
    blocks.push({
      key: 'peringatan',
      weight: res.peringatan.length * 62,
      node: (
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
      ),
    });
  }

  blocks.push({
    key: 'langkah',
    weight: 45 + res.parameterMesin.urutanProses.length * 52,
    node: (
      <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ width: 7, height: 18, borderRadius: 4, background: '#1D4ED8' }} />
          <div style={{ fontSize: 16, fontWeight: 800 }}>Langkah Produksi</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {res.parameterMesin.urutanProses.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, width: 25, height: 25, borderRadius: 8, background: '#E1EBFB', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, color: '#3A4742', paddingTop: 2 }}>{step.replace(/^\d+\.\s*/, '')}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  });

  // Greedy balance: walk blocks in order, always dropping the next one into
  // whichever column currently carries less estimated weight. Preserves each
  // block's relative order within its assigned column without hand-picking
  // per-card placement, and re-balances automatically as content changes.
  // Rendered as two independent flex columns (not CSS grid) so a tall block
  // in one column never forces blank space into the other's row track.
  const leftBlocks: typeof blocks = [];
  const rightBlocks: typeof blocks = [];
  let leftWeight = 0;
  let rightWeight = 0;
  for (const b of blocks) {
    if (leftWeight <= rightWeight) {
      leftBlocks.push(b);
      leftWeight += b.weight;
    } else {
      rightBlocks.push(b);
      rightWeight += b.weight;
    }
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          active="none"
          onGoDash={onBack}
          onGoIngredients={onGoIngredients}
          onStartForm={onStartForm}
          onGoHelp={onGoHelp}
          onLogout={onLogout}
        />
      }
    >
      <StickyHeader
        onBack={onBack}
        title={entry.nama}
        subtitle={`${entry.tanggal} · ${entry.fase} · ${entry.targetKg} kg`}
      />

      <div className="result-columns" style={{ flex: 1, padding: '18px 18px 120px' }}>
        {/* SNI badge — always a full-width hero banner above the columns */}
        <div style={{ borderRadius: 20, padding: 18, display: 'flex', alignItems: 'center', gap: 15, background: sniOk ? '#E1EBFB' : '#FBF1D9', border: `1.5px solid ${sniOk ? '#B9CDF3' : '#EAC97F'}` }}>
          <span style={{ fontSize: 32, flexShrink: 0 }}>{sniOk ? '✅' : '⚠️'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: sniOk ? '#3568C7' : '#A6802F' }}>Status Mutu</div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.02em', color: sniOk ? '#1D4ED8' : '#825511', lineHeight: 1.1, marginTop: 2 }}>{sniOk ? 'Sesuai SNI' : 'Belum Sesuai SNI'}</div>
          </div>
        </div>

        {/* Mobile / tablet: single flowing stack in original priority order */}
        <div className="result-stack">
          {blocks.map(b => <div key={b.key}>{b.node}</div>)}
        </div>

        {/* Desktop: two independent columns, weight-balanced (see blocks/leftBlocks/rightBlocks above) */}
        <div className="result-two-col">
          <div className="result-col">{leftBlocks.map(b => <div key={b.key}>{b.node}</div>)}</div>
          <div className="result-col">{rightBlocks.map(b => <div key={b.key}>{b.node}</div>)}</div>
        </div>
      </div>

      <StickyFooter>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px 20px', borderRadius: 14, background: '#fff', border: '1.5px solid #E2DDCE', color: '#46554E', fontSize: 15, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>Beranda</button>
        <button
          onClick={kirimKeMesin}
          disabled={kirimStatus === 'sending'}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            padding: 15,
            borderRadius: 14,
            fontSize: 15.5,
            fontWeight: 800,
            cursor: kirimStatus === 'sending' ? 'wait' : 'pointer',
            border: 'none',
            background:
              kirimStatus === 'sent' ? '#2563EB' : kirimStatus === 'error' ? '#C24B3A' : '#1D4ED8',
            color: '#fff',
          }}
        >
          {kirimStatus === 'sending' ? (
            'Mengirim…'
          ) : kirimStatus === 'sent' ? (
            <>✓ Terkirim ke Mesin</>
          ) : kirimStatus === 'error' ? (
            <>⚠ Gagal, coba lagi</>
          ) : (
            <>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
              Kirim ke Mesin
            </>
          )}
        </button>
      </StickyFooter>
    </AppShell>
  );
}
