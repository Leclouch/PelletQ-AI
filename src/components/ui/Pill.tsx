import { pill } from '@/lib/helpers';

interface PillProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export default function Pill({ selected, onClick, children }: PillProps) {
  return (
    <button onClick={onClick} style={pill(selected)}>
      {children}
    </button>
  );
}
