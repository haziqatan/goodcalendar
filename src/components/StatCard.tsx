import { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}

export function StatCard({ icon: Icon, label, value, hint }: Props) {
  return (
    <div className="glass stat-card">
      <div className="stat-card__icon">
        <Icon size={18} />
      </div>
      <div>
        <p>{label}</p>
        <h3>{value}</h3>
        <span>{hint}</span>
      </div>
    </div>
  );
}
