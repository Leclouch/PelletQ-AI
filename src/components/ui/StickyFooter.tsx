export default function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 11, padding: '14px 18px calc(14px + env(safe-area-inset-bottom))', background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(10px)', borderTop: '1px solid #F0F0F0' }}>
      {children}
    </div>
  );
}
