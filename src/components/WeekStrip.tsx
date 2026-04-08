import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  start: Date;
  selected: string;
  onShift: (offset: number) => void;
  onSelect: (iso: string) => void;
}

export function WeekStrip({ start, selected, onShift, onSelect }: Props) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  return (
    <div className="glass week-strip">
      <div className="week-strip__head">
        <div>
          <p className="eyebrow">Unlimited week range</p>
          <h2>{start.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2>
        </div>
        <div className="week-strip__controls">
          <button onClick={() => onShift(-7)} className="icon-btn" aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => onShift(7)} className="icon-btn" aria-label="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="week-days">
        {days.map((day) => {
          const iso = day.toISOString().slice(0, 10);
          const active = iso === selected;
          return (
            <button key={iso} onClick={() => onSelect(iso)} className={`day-pill ${active ? 'active' : ''}`}>
              <span>{day.toLocaleString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
