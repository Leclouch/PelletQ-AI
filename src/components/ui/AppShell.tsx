interface AppShellProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  narrow?: boolean;
  background?: string;
}

export default function AppShell({ children, sidebar, narrow, background }: AppShellProps) {
  return (
    <div
      className={`app-shell-outer${sidebar ? ' has-sidebar' : ''}${background ? ' has-bg-image' : ''}`}
      style={
        background
          ? { backgroundImage: `linear-gradient(rgba(255,255,255,.6), rgba(255,255,255,.6)), url("${encodeURI(background)}")` }
          : undefined
      }
    >
      {sidebar}
      <div className={`app-shell-inner${narrow ? ' content-narrow' : ''}`}>
        {children}
      </div>
    </div>
  );
}
