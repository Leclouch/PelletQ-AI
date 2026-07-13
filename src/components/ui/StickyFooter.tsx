export default function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 11, padding: '14px 18px calc(14px + env(safe-area-inset-bottom))', background: 'rgba(246,242,233,.94)', backdropFilter: 'blur(10px)', borderTop: '1px solid #EDE7D8' }}>
      {children}
    </div>
  );
}
