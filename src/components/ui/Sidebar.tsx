'use client';

import { useState } from 'react';
import Image from 'next/image';
import LogoutConfirmModal from './LogoutConfirmModal';
import logo from '../../../assets/Logo_PelletQ-AI.png';

interface SidebarProps {
  active: 'dashboard' | 'ingredients';
  onGoDash: () => void;
  onGoIngredients: () => void;
  onStartForm: () => void;
  onGoHelp: () => void;
  onLogout: () => void;
}

const navItemStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 12px', borderRadius: 12,
  fontSize: 14, fontWeight: isActive ? 800 : 600, cursor: 'pointer', textAlign: 'left',
  color: isActive ? '#2563EB' : '#46554E', background: isActive ? '#E1EBFB' : 'transparent',
});

export default function Sidebar({ active, onGoDash, onGoIngredients, onStartForm, onGoHelp, onLogout }: SidebarProps) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  return (
    <div className="sidebar-nav" style={{ background: '#F3F6FC', borderRight: '1px solid #E5EAF3', padding: '22px 16px', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 6px', marginBottom: 22 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Image src={logo} alt="PelletQ-AI logo" width={34} height={34} unoptimized />
        </div>
        <span style={{
          fontSize: 16, fontWeight: 800, letterSpacing: '-.02em',
          background: 'linear-gradient(135deg, #7700FF 0%, #2563EB 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>PelletQ-AI</span>
      </div>

      <button onClick={onStartForm} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', padding: '13px 12px', borderRadius: 13, background: 'linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)', color: '#fff', fontSize: 14, fontWeight: 800, letterSpacing: '-.01em', cursor: 'pointer', boxShadow: '0 6px 16px rgba(29,78,216,.26)', marginBottom: 18 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Tambah Formulasi
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <button onClick={onGoDash} style={navItemStyle(active === 'dashboard')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active === 'dashboard' ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Beranda
        </button>
        <button onClick={onGoIngredients} style={navItemStyle(active === 'ingredients')}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active === 'ingredients' ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          Kelola Bahan
        </button>
        <button onClick={onGoHelp} style={navItemStyle(false)}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Bantuan
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid #E5EAF3', paddingTop: 12, marginTop: 4 }}>
        <button onClick={() => setConfirmingLogout(true)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 12px', borderRadius: 12, fontSize: 14, fontWeight: 800, textAlign: 'left', color: '#C06A4E', background: '#FBEDE7', cursor: 'pointer' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Keluar
        </button>
      </div>

      <LogoutConfirmModal open={confirmingLogout} onCancel={() => setConfirmingLogout(false)} onConfirm={onLogout} />
    </div>
  );
}
