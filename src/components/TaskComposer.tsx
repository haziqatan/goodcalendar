import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { TaskItem, TaskPriority, TaskType } from '../types';

interface Props {
  selectedDate: string;
  onCreate: (task: Omit<TaskItem, 'id' | 'done'>) => Promise<void> | void;
}

export function TaskComposer({ selectedDate, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(60);
  const [startTime, setStartTime] = useState('09:00');
  const [type, setType] = useState<TaskType>('task');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [deadline, setDeadline] = useState(selectedDate);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const [hours, minutes] = startTime.split(':').map(Number);
    await onCreate({
      title: title.trim(),
      duration,
      type,
      priority,
      deadline,
      scheduled_date: selectedDate,
      start_minutes: hours * 60 + minutes,
      description: '',
    });
    setTitle('');
    setDuration(60);
    setType('task');
    setPriority('medium');
  };

  return (
    <form className="glass composer" onSubmit={submit}>
      <div className="composer__headline">
        <div>
          <p className="eyebrow">Quick schedule</p>
          <h2>Create a task, focus block, or buffer</h2>
        </div>
        <button type="submit" className="primary-btn">
          <Plus size={18} />
          Add block
        </button>
      </div>
      <div className="composer__grid">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deep work for onboarding flow" />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            <option value="task">Task</option>
            <option value="focus">Focus time</option>
            <option value="buffer">Buffer time</option>
          </select>
        </label>
        <label>
          Duration (minutes)
          <input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </label>
        <label>
          Start time
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label>
          Deadline
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
    </form>
  );
}
