interface AppShellProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  narrow?: boolean;
}

export default function AppShell({ children, sidebar, narrow }: AppShellProps) {
  return (
    <div className={`app-shell-outer${sidebar ? ' has-sidebar' : ''}`}>
      {sidebar}
      <div className={`app-shell-inner${narrow ? ' content-narrow' : ''}`}>
        {children}
      </div>
    </div>
  );
}
