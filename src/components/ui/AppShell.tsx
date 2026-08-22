interface AppShellProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
}

export default function AppShell({ children, sidebar }: AppShellProps) {
  return (
    <div className={`app-shell-outer${sidebar ? ' has-sidebar' : ''}`}>
      {sidebar}
      <div className="app-shell-inner">
        {children}
      </div>
    </div>
  );
}
