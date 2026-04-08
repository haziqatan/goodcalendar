import { Clock4 } from 'lucide-react';
import type { TaskItem } from '../types';

interface Props {
  items: TaskItem[];
  onToggle: (id: string, next: boolean) => Promise<void> | void;
}

const typeLabel: Record<TaskItem['type'], string> = {
  task: 'Task',
  focus: 'Focus',
  buffer: 'Buffer',
};

export function Timeline({ items, onToggle }: Props) {
  return (
    <div className="glass timeline-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Day timeline</p>
          <h2>Your magnetic schedule</h2>
        </div>
      </div>
      <div className="timeline-list">
        {items.length === 0 ? (
          <div className="empty-state">
            <Clock4 size={18} />
            <p>No blocks yet for this day. Add one from the composer to start shaping the week.</p>
          </div>
        ) : (
          items.map((item) => {
            const startHours = Math.floor(item.start_minutes / 60)
              .toString()
              .padStart(2, '0');
            const startMinutes = (item.start_minutes % 60).toString().padStart(2, '0');
            const end = item.start_minutes + item.duration;
            const endHours = Math.floor(end / 60)
              .toString()
              .padStart(2, '0');
            const endMinutes = (end % 60).toString().padStart(2, '0');
            return (
              <label key={item.id} className={`timeline-item ${item.type} ${item.done ? 'done' : ''}`}>
                <input type="checkbox" checked={item.done} onChange={(e) => onToggle(item.id, e.target.checked)} />
                <div className="timeline-item__meta">
                  <span>{typeLabel[item.type]}</span>
                  <strong>{startHours}:{startMinutes} — {endHours}:{endMinutes}</strong>
                </div>
                <div className="timeline-item__content">
                  <h3>{item.title}</h3>
                  <p>{item.priority} priority · deadline {item.deadline ?? 'none'}</p>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
