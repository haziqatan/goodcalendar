import { useEffect, useMemo, useState } from 'react';
import { AlarmClockCheck, CalendarRange, Layers3, Sparkles } from 'lucide-react';
import { OrbBackground } from './components/OrbBackground';
import { StatCard } from './components/StatCard';
import { TaskComposer } from './components/TaskComposer';
import { Timeline } from './components/Timeline';
import { WeekStrip } from './components/WeekStrip';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { ScheduleStats, TaskItem } from './types';

const starterTasks: TaskItem[] = [
  {
    id: '1',
    title: 'Design landing page interactions',
    type: 'focus',
    priority: 'high',
    duration: 120,
    deadline: new Date().toISOString().slice(0, 10),
    scheduled_date: new Date().toISOString().slice(0, 10),
    start_minutes: 9 * 60,
    done: false,
  },
  {
    id: '2',
    title: 'Buffer before sprint review',
    type: 'buffer',
    priority: 'medium',
    duration: 30,
    deadline: new Date().toISOString().slice(0, 10),
    scheduled_date: new Date().toISOString().slice(0, 10),
    start_minutes: 11 * 60 + 30,
    done: false,
  },
  {
    id: '3',
    title: 'Outline content backlog',
    type: 'task',
    priority: 'medium',
    duration: 75,
    deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    scheduled_date: new Date().toISOString().slice(0, 10),
    start_minutes: 14 * 60,
    done: true,
  },
];

function startOfWeek(date: Date) {
  const clone = new Date(date);
  const day = clone.getDay();
  const diff = clone.getDate() - day + (day === 0 ? -6 : 1);
  clone.setDate(diff);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

export default function App() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [selectedDate, setSelectedDate] = useState(today.toISOString().slice(0, 10));
  const [tasks, setTasks] = useState<TaskItem[]>(starterTasks);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Running with local demo data. Add Supabase anon key to enable cloud sync.');

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      const { data, error } = await supabase.from('schedule_items').select('*').order('scheduled_date').order('start_minutes');
      if (error) {
        setSyncMessage(error.message);
      } else if (data) {
        setTasks(data as TaskItem[]);
        setSyncMessage('Connected to Supabase and syncing schedule items live.');
      }
      setLoading(false);
    };
    void load();
  }, []);

  const dayItems = useMemo(
    () => tasks.filter((task) => task.scheduled_date === selectedDate).sort((a, b) => a.start_minutes - b.start_minutes),
    [selectedDate, tasks],
  );

  const stats: ScheduleStats = useMemo(() => {
    const focusMinutes = tasks.filter((task) => task.type === 'focus').reduce((sum, task) => sum + task.duration, 0);
    const bufferMinutes = tasks.filter((task) => task.type === 'buffer').reduce((sum, task) => sum + task.duration, 0);
    const completionRate = tasks.length ? Math.round((tasks.filter((task) => task.done).length / tasks.length) * 100) : 0;
    return {
      tasks: tasks.length,
      focusMinutes,
      bufferMinutes,
      completionRate,
    };
  }, [tasks]);

  const shiftWeek = (offset: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + offset);
    setWeekStart(next);
  };

  const createTask = async (payload: Omit<TaskItem, 'id' | 'done'>) => {
    const item: TaskItem = {
      id: crypto.randomUUID(),
      done: false,
      ...payload,
    };

    setTasks((prev) => [...prev, item]);

    if (!supabase) return;
    const { error } = await supabase.from('schedule_items').insert(item);
    if (error) {
      setSyncMessage(`Insert failed: ${error.message}`);
      setTasks((prev) => prev.filter((entry) => entry.id !== item.id));
    }
  };

  const toggleTask = async (id: string, next: boolean) => {
    const previous = tasks;
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, done: next } : task)));
    if (!supabase) return;
    const { error } = await supabase.from('schedule_items').update({ done: next }).eq('id', id);
    if (error) {
      setSyncMessage(`Update failed: ${error.message}`);
      setTasks(previous);
    }
  };

  return (
    <main className="app-shell">
      <OrbBackground />
      <div className="noise" />
      <section className="hero glass">
        <div>
          <p className="eyebrow">GoodCalendar · Motion-inspired web app</p>
          <h1>Unlimited scheduling, crafted for deep work and beautiful weekly planning.</h1>
          <p className="hero-copy">
            Build around the essentials first: unlimited week navigation, unlimited focus blocks, unlimited tasks, and unlimited buffer time.
            This starter is built for React + Supabase and styled with a React Bits-inspired visual system.
          </p>
          <div className="hero-badges">
            <span>Unlimited week range</span>
            <span>Unlimited focus time</span>
            <span>Unlimited tasks</span>
            <span>Unlimited buffer time</span>
          </div>
        </div>
        <div className="hero-right glass soft-panel">
          <div className="status-dot" />
          <strong>{hasSupabaseConfig ? 'Supabase ready' : 'Supabase partially configured'}</strong>
          <p>{syncMessage}</p>
          <small>{loading ? 'Loading your schedule…' : 'Deploy to Vercel after adding your anon key to .env.'}</small>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard icon={Layers3} label="Unlimited tasks" value={String(stats.tasks)} hint="No feature cap in this starter" />
        <StatCard icon={Sparkles} label="Focus time" value={`${stats.focusMinutes} min`} hint="Design your deep-work blocks freely" />
        <StatCard icon={AlarmClockCheck} label="Buffer time" value={`${stats.bufferMinutes} min`} hint="Protect transitions and recovery" />
        <StatCard icon={CalendarRange} label="Completion" value={`${stats.completionRate}%`} hint="Track momentum at a glance" />
      </section>

      <WeekStrip start={weekStart} selected={selectedDate} onShift={shiftWeek} onSelect={setSelectedDate} />

      <section className="content-grid">
        <div className="left-col">
          <TaskComposer selectedDate={selectedDate} onCreate={createTask} />
          <Timeline items={dayItems} onToggle={toggleTask} />
        </div>
        <aside className="glass insights-panel">
          <p className="eyebrow">Product scope</p>
          <h2>What this build includes</h2>
          <ul>
            <li>Weekly navigation with no range limit</li>
            <li>Dedicated focus blocks for deep work</li>
            <li>Unlimited task creation</li>
            <li>Unlimited buffer blocks for flexible planning</li>
            <li>Supabase-ready persistence layer</li>
            <li>Polished animated hero and glass UI</li>
          </ul>
          <div className="divider" />
          <p className="eyebrow">Next recommended features</p>
          <ul>
            <li>Drag-and-drop rescheduling</li>
            <li>Auto-placement engine with conflict detection</li>
            <li>Google Calendar sync</li>
            <li>Priority-aware deadline warnings</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}
