import Image from 'next/image';
import AppShell from '@/components/ui/AppShell';
import BottomNav from '@/components/ui/BottomNav';
import Sidebar from '@/components/ui/Sidebar';
import { RiwayatEntry } from '@/lib/types';
import { rp, todayStr } from '@/lib/helpers';
import logo from '../../../assets/Logo_PelletQ-AI.png';

interface DashboardScreenProps {
  riwayat: RiwayatEntry[];
  fishSpeciesId: string;
  renamingId: string | null;
  renameValue: string;
  deletingId: string | null;
  onStart: () => void;
  onGoIngredients: () => void;
  onGoHelp: () => void;
  onLogout: () => void;
  onOpenDetail: (id: string) => void;
  onStartRename: (id: string) => void;
  onRenameInput: (v: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onStartDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}

export default function DashboardScreen({
  riwayat, fishSpeciesId, renamingId, renameValue, deletingId,
  onStart, onGoIngredients, onGoHelp, onLogout, onOpenDetail,
  onStartRename, onRenameInput, onSaveRename, onCancelRename,
  onStartDelete, onConfirmDelete, onCancelDelete,
}: DashboardScreenProps) {
  return (
    <AppShell
      sidebar={
        <Sidebar
          active="dashboard"
          onGoDash={() => {}}
          onGoIngredients={onGoIngredients}
          onStartForm={onStart}
          onGoHelp={onGoHelp}
          onLogout={onLogout}
        />
      }
    >
      {/* Header */}
      <div style={{ background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 5, borderBottom: '1px solid #F0F0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Image src={logo} alt="PelletQ-AI logo" width={40} height={40} priority unoptimized />
          </div>
          <span style={{
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '-.02em',
            background: 'linear-gradient(135deg, #7700FF 0%, #2563EB 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>PelletQ-AI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999, background: fishSpeciesId ? '#E1EBFB' : '#FBE9E5', border: `1px solid ${fishSpeciesId ? '#BFD6F5' : '#EDC4BB'}` }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: fishSpeciesId ? '#2563EB' : '#B9433A', boxShadow: fishSpeciesId ? '0 0 0 3px rgba(37,99,235,.18)' : '0 0 0 3px rgba(185,67,58,.16)', display: 'block' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: fishSpeciesId ? '#1D4ED8' : '#9E3B30' }}>
            {fishSpeciesId ? 'Sistem Aktif' : 'Menghubungkan…'}
          </span>
        </div>
      </div>

      <div style={{ padding: '20px 18px 140px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Greeting */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C8A82' }}>Selamat datang kembali</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', marginTop: 2 }}>Halo, Pak Nanang 👋</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#9AA69E', marginTop: 3 }}>Yogyakarta · {todayStr()}</div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: '15px 16px', boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#1D4ED8', lineHeight: 1, letterSpacing: '-.03em' }}>{riwayat.length}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#7C8A82', marginTop: 7 }}>Formulasi dibuat</div>
          </div>
          <div style={{ background: '#2563EB', borderRadius: 18, padding: '15px 16px', color: '#fff', boxShadow: '0 6px 16px rgba(37,99,235,.22)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .85, textTransform: 'uppercase', letterSpacing: '.06em' }}>Terakhir</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 5, lineHeight: 1.2 }}>{riwayat[0]?.nama ?? '—'}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, opacity: .85, marginTop: 3 }}>{riwayat[0]?.tanggal ?? ''}</div>
          </div>
        </div>

        {/* CTAs — hidden on desktop sidebar layout, where the sidebar already covers these actions */}
        <div className="dashboard-ctas" style={{ flexDirection: 'column', gap: 10 }}>
          <button onClick={onStart} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 18, borderRadius: 18, background: 'linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)', color: '#fff', fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em', cursor: 'pointer', boxShadow: '0 8px 20px rgba(29,78,216,.26)' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,.22)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            Buat Formulasi Baru
          </button>
          <button onClick={onGoIngredients} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '15px 18px', borderRadius: 18, background: '#fff', border: '1.5px solid #2563EB', color: '#2563EB', fontSize: 15, fontWeight: 800, letterSpacing: '-.01em', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            Kelola Bahan
          </button>
        </div>

        {/* History */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em' }}>Riwayat Formulasi</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9AA69E' }}>{riwayat.length} resep</div>
          </div>
          {riwayat.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9AA69E', fontSize: 13.5, fontWeight: 600 }}>
              Belum ada formulasi. Mulai buat yang pertama!
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {riwayat.map(r => (
              <div key={r.id} style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 16, padding: 14, boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
                {deletingId === r.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: '#8F3520' }}>Hapus formulasi ini?</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => onConfirmDelete(r.id)} style={{ fontSize: 12, fontWeight: 800, padding: '7px 12px', borderRadius: 9, background: '#C06A4E', color: '#fff', cursor: 'pointer' }}>Ya, hapus</button>
                      <button onClick={onCancelDelete} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 9, background: '#F0EDE5', color: '#46554E', cursor: 'pointer' }}>Batal</button>
                    </div>
                  </div>
                ) : renamingId === r.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input value={renameValue} onChange={e => onRenameInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSaveRename(); if (e.key === 'Escape') onCancelRename(); }} autoFocus style={{ flex: 1, fontSize: 14.5, fontWeight: 700, padding: '8px 10px', border: '1.5px solid #2563EB', borderRadius: 10, outline: 'none' }} />
                    <button onClick={onSaveRename} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: '#2563EB', borderRadius: 10, padding: '9px 13px', cursor: 'pointer' }}>Simpan</button>
                    <button onClick={onCancelRename} style={{ fontSize: 12, fontWeight: 700, color: '#46554E', background: '#F0EDE5', borderRadius: 10, padding: '9px 13px', cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => onOpenDetail(r.id)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nama}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA69E', marginTop: 2 }}>{r.tanggal} · {r.targetKg} kg</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: r.sniOk ? '#E1EBFB' : '#FBF1D9', color: r.sniOk ? '#1D4ED8' : '#9A6A12' }}>{r.sniOk ? 'SNI ✓' : 'Cek SNI'}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#46554E' }}>{rp(r.biayaPerKg)}<span style={{ fontSize: 10, fontWeight: 600, color: '#9AA69E' }}>/kg</span></span>
                      </div>
                    </button>
                    <button onClick={() => onStartRename(r.id)} title="Ubah nama" style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F6F3EA', border: '1px solid #E7E1D2', borderRadius: 10, cursor: 'pointer' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C8A80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={() => onStartDelete(r.id)} title="Hapus" style={{ flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FBEDE7', border: '1px solid #EDC4BB', borderRadius: 10, cursor: 'pointer' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C06A4E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomNav
        active="dashboard"
        onGoDash={() => {}}
        onGoIngredients={onGoIngredients}
        onStartForm={onStart}
        onGoHelp={onGoHelp}
        onLogout={onLogout}
      />
    </AppShell>
  );
}
