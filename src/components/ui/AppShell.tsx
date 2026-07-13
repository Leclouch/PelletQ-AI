export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: 'radial-gradient(120% 80% at 50% 0%, #EFEADd 0%, #E3DCCC 100%)' }}>
      <div style={{ width: '100%', maxWidth: 440, minHeight: '100vh', background: '#F6F2E9', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: '0 0 60px rgba(28,46,39,.10)' }}>
        {children}
      </div>
    </div>
  );
}
