import Image from 'next/image';
import AppShell from '@/components/ui/AppShell';
import StickyHeader from '@/components/ui/StickyHeader';
import logo from '../../../assets/Logo_PelletQ-AI.png';

interface HelpScreenProps {
  onBack: () => void;
}

const cardStyle: React.CSSProperties = { background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, padding: 16, boxShadow: '0 1px 2px rgba(28,46,39,.04)' };
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 800, marginBottom: 10 };

const STEPS = [
  'Buat Formulasi — masukkan data ikan (fase, umur, jumlah) dan target produksi.',
  'Pilih bahan baku — tentukan minimal 3 bahan beserta stok & harga yang tersedia.',
  'Sistem menghitung formulasi optimal dan memvalidasinya terhadap SNI 01-4087-2006.',
  'Kirim ke mesin — resep per batch dikirim otomatis ke mesin pelet, atau dijalankan manual dari dashboard.',
];

export default function HelpScreen({ onBack }: HelpScreenProps) {
  return (
    <AppShell>
      <StickyHeader onBack={onBack} title="Bantuan" subtitle="Tentang PelletQ-AI" />

      <div style={{ flex: 1, padding: '18px 18px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* About */}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '22px 18px' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Image src={logo} alt="PelletQ-AI logo" width={56} height={56} unoptimized />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em' }}>PelletQ-AI</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#9AA69E', marginTop: 4 }}>
              Formulasi pakan lele otomatis berbasis SNI
            </div>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#B3AF9F' }}>PelletQ-AI · PKM-PI UGM</div>
        </div>

        {/* SNI explainer */}
        <div style={cardStyle}>
          <div style={cardTitle}>Validasi SNI</div>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.55, color: '#46554E' }}>
            Setiap formulasi yang dihitung sistem otomatis dicek terhadap SNI 01-4087-2006 (pakan buatan untuk lele) —
            meliputi kadar protein, lemak, serat kasar, abu, kadar air, dan diameter pelet sesuai fase budidaya. Formulasi
            yang belum memenuhi standar akan diberi saran perbaikan sebelum dikirim ke mesin.
          </div>
        </div>

        {/* How to use */}
        <div style={cardStyle}>
          <div style={cardTitle}>Cara Pakai</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, width: 25, height: 25, borderRadius: 8, background: '#E1EBFB', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, color: '#3A4742', paddingTop: 2 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
