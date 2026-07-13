import { smallPill } from '@/lib/helpers';

interface SmallPillProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export default function SmallPill({ selected, onClick, children }: SmallPillProps) {
  return (
    <button onClick={onClick} style={smallPill(selected)}>
      {children}
    </button>
  );
}
