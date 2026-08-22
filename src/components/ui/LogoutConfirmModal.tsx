'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface LogoutConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function LogoutConfirmModal({ open, onCancel, onConfirm }: LogoutConfirmModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(28,46,39,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 22, padding: 24, width: '100%', maxWidth: 300, boxShadow: '0 24px 60px rgba(28,46,39,.28)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: '#FBEDE7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C06A4E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em' }}>Keluar dari akun?</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9AA69E', marginTop: 5, lineHeight: 1.4 }}>Anda perlu masuk kembali untuk melanjutkan.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px 0', borderRadius: 13, background: '#F0EDE5', color: '#46554E', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Batal</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '12px 0', borderRadius: 13, background: '#C06A4E', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Ya, keluar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
