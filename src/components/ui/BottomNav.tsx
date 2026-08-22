'use client';

import { useState } from 'react';
import LogoutConfirmModal from './LogoutConfirmModal';

interface BottomNavProps {
  active: 'dashboard' | 'ingredients';
  onGoDash: () => void;
  onGoIngredients: () => void;
  onStartForm: () => void;
  onGoHelp: () => void;
  onLogout: () => void;
}

const tabStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 3, flex: 1, padding: '6px 2px', color: isActive ? '#2563EB' : '#9AA69E',
  fontSize: 10.5, fontWeight: isActive ? 800 : 600, cursor: 'pointer', background: 'none', border: 'none',
});

export default function BottomNav({ active, onGoDash, onGoIngredients, onStartForm, onGoHelp, onLogout }: BottomNavProps) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  return (
    <>
      <div className="bottom-nav" style={{ position: 'sticky', bottom: 0, zIndex: 6, alignItems: 'flex-end', padding: '8px 6px calc(8px + env(safe-area-inset-bottom))', background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(10px)', borderTop: '1px solid #F0F0F0' }}>
        <button onClick={onGoDash} style={tabStyle(active === 'dashboard')}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active === 'dashboard' ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Beranda
        </button>

        <button onClick={onGoIngredients} style={tabStyle(active === 'ingredients')}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active === 'ingredients' ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          Bahan
        </button>

        {/* Center: Tambah Formulasi — raised primary action */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: 'translateY(-14px)' }}>
          <button onClick={onStartForm} aria-label="Tambah Formulasi" style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(29,78,216,.32)', cursor: 'pointer', border: '4px solid #fff', flexShrink: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#2563EB' }}>Tambah</span>
        </div>

        <button onClick={onGoHelp} style={tabStyle(false)}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Bantuan
        </button>

        <button onClick={() => setConfirmingLogout(true)} style={tabStyle(false)}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Keluar
        </button>
      </div>

      <LogoutConfirmModal open={confirmingLogout} onCancel={() => setConfirmingLogout(false)} onConfirm={onLogout} />
    </>
  );
}
