interface StickyHeaderProps {
  onBack?: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}

export default function StickyHeader({ onBack, title, subtitle, right, children }: StickyHeaderProps) {
  return (
    <div style={{ background: 'rgba(246,242,233,.92)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 5, borderBottom: '1px solid #EDE7D8', padding: '14px 18px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: children ? 14 : 0 }}>
        {onBack && (
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: '#fff', border: '1px solid #E8E2D4', cursor: 'pointer', color: '#46554E', flexShrink: 0 }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.01em', color: '#1C2E27' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, fontWeight: 700, color: '#1A8A5E' }}>{subtitle}</div>}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}
