import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import {
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import {
  AUTO_START_MINUTES,
  PIXELS_PER_MINUTE,
  addDays,
  autoPlaceDay,
  buildWarnings,
  clampStart,
  findConflict,
  findPlacement,
  formatDate,
  formatRange,
  formatTime,
  fromDateKey,
  sortTasksChronologically,
  startOfWeek,
  toDateKey,
} from './lib/scheduler';
import type { ScheduleWarning, TaskItem, TaskPriority, TaskType } from './types';

type ViewMode = 'planner' | 'priorities';
type RailTab = 'priorities' | 'tasks';
type PriorityBucket = 'critical' | TaskPriority;

interface TaskDraft {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  deadline: string;
}

const TIME_GUTTER = 72;
const VISIBLE_START_MINUTES = 6 * 60;
const hourMarkers = Array.from({ length: 15 }, (_, index) => (6 + index) * 60);
const bucketOrder: PriorityBucket[] = ['critical', 'high', 'medium', 'low'];

const starterTasks: TaskItem[] = [
  {
    id: 'starter-1',
    title: 'Lunch',
    type: 'task',
    priority: 'high',
    duration: 60,
    deadline: addDays(toDateKey(new Date()), 1),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 11 * 60 + 45,
    done: false,
  },
  {
    id: 'starter-2',
    title: 'Lunch Hour',
    type: 'buffer',
    priority: 'medium',
    duration: 75,
    deadline: toDateKey(new Date()),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 12 * 60 + 45,
    done: false,
  },
  {
    id: 'starter-3',
    title: 'Deep work',
    type: 'focus',
    priority: 'high',
    duration: 120,
    deadline: addDays(toDateKey(new Date()), 2),
    scheduled_date: addDays(toDateKey(new Date()), 1),
    start_minutes: 13 * 60,
    done: false,
  },
];

const navPrimary = [
  { id: 'planner' as ViewMode, label: 'Planner', icon: CalendarRange },
  { id: 'priorities' as ViewMode, label: 'Priorities', icon: BarChart3 },
];

const navSecondary = [
  { label: 'Stats', icon: BarChart3 },
  { label: 'Time blocking', icon: Clock3, children: ['Focus', 'Habits', 'Buffers', 'Tasks'] },
  { label: 'Meetings', icon: Users, children: ['Smart Meetings', 'Scheduling Links'] },
  { label: 'Calendar Sync', icon: Link2 },
];

function normalizeTask(task: TaskItem) {
  return {
    ...task,
    description: task.description ?? '',
  };
}

function taskBucket(task: TaskItem, todayKey: string): PriorityBucket {
  if (task.deadline && (task.deadline < todayKey || task.scheduled_date > task.deadline)) {
    return 'critical';
  }
  return task.priority;
}

function sortPriorityTasks(tasks: TaskItem[]) {
  return [...tasks].sort((left, right) => {
    const leftDeadline = left.deadline ?? '9999-12-31';
    const rightDeadline = right.deadline ?? '9999-12-31';
    if (leftDeadline !== rightDeadline) {
      return leftDeadline.localeCompare(rightDeadline);
    }
    if (left.scheduled_date !== right.scheduled_date) {
      return left.scheduled_date.localeCompare(right.scheduled_date);
    }
    return left.start_minutes - right.start_minutes;
  });
}

function taskTypeLabel(type: TaskType) {
  if (type === 'focus') return 'Focus';
  if (type === 'buffer') return 'Buffer';
  return 'Task';
}

export default function App() {
  const todayKey = toDateKey(new Date());
  const [view, setView] = useState<ViewMode>('planner');
  const [railTab, setRailTab] = useState<RailTab>('priorities');
  const [query, setQuery] = useState('');
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [tasks, setTasks] = useState<TaskItem[]>(hasSupabaseConfig ? [] : starterTasks);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(
    hasSupabaseConfig ? 'Connecting to Supabase schedule…' : 'Local mode. Add Vercel env vars to sync across devices.',
  );
  const [statusMessage, setStatusMessage] = useState('Drag blocks across the planner to reschedule them.');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>({
    title: '',
    type: 'task',
    priority: 'medium',
    duration: 60,
    deadline: todayKey,
  });

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      const { data, error } = await supabase.from('schedule_items').select('*').order('scheduled_date').order('start_minutes');
      if (error) {
        setSyncMessage(error.message);
      } else if (data) {
        const normalized = sortTasksChronologically((data as TaskItem[]).map(normalizeTask));
        setTasks(normalized);
        setSyncMessage(normalized.length === 0 ? 'Supabase connected. No tasks yet.' : 'Supabase connected.');
      }
      setLoading(false);
    };
    void load();
  }, []);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toDateKey(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index))),
    [weekStart],
  );

  const weekTasks = useMemo(
    () => sortTasksChronologically(tasks.filter((task) => weekDates.includes(task.scheduled_date))),
    [tasks, weekDates],
  );

  const selectedDayItems = useMemo(
    () => sortTasksChronologically(tasks.filter((task) => task.scheduled_date === selectedDate)),
    [tasks, selectedDate],
  );

  const warnings = useMemo<ScheduleWarning[]>(
    () => buildWarnings(tasks, todayKey, selectedDate),
    [tasks, todayKey, selectedDate],
  );

  const filteredOpenTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks
      .filter((task) => !task.done)
      .filter((task) => (normalizedQuery ? task.title.toLowerCase().includes(normalizedQuery) : true));
  }, [query, tasks]);

  const groupedTasks = useMemo(() => {
    const grouped: Record<PriorityBucket, TaskItem[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };

    filteredOpenTasks.forEach((task) => {
      grouped[taskBucket(task, todayKey)].push(task);
    });

    bucketOrder.forEach((bucket) => {
      grouped[bucket] = sortPriorityTasks(grouped[bucket]);
    });

    return grouped;
  }, [filteredOpenTasks, todayKey]);

  const scheduledMinutes = useMemo(
    () => weekTasks.filter((task) => !task.done).reduce((sum, task) => sum + task.duration, 0),
    [weekTasks],
  );

  const weeklyFocusMinutes = useMemo(
    () => weekTasks.filter((task) => !task.done && task.type === 'focus').reduce((sum, task) => sum + task.duration, 0),
    [weekTasks],
  );

  const weeklyTaskMinutes = useMemo(
    () => weekTasks.filter((task) => !task.done && task.type === 'task').reduce((sum, task) => sum + task.duration, 0),
    [weekTasks],
  );

  const weeklyBufferMinutes = useMemo(
    () => weekTasks.filter((task) => !task.done && task.type === 'buffer').reduce((sum, task) => sum + task.duration, 0),
    [weekTasks],
  );

  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter((task) => task.done).length / tasks.length) * 100);
  }, [tasks]);

  const capacityMinutes = 7 * 12 * 60;
  const freeMinutes = Math.max(capacityMinutes - scheduledMinutes, 0);

  const focusDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setWeekStart(startOfWeek(fromDateKey(dateKey)));
  };

  const shiftWeek = (offset: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + offset);
    setWeekStart(next);
  };

  const persistTaskUpdate = async (id: string, patch: Partial<TaskItem>, previousTasks: TaskItem[]) => {
    if (!supabase) {
      return true;
    }

    const { error } = await supabase.from('schedule_items').update(patch).eq('id', id);
    if (error) {
      setTasks(previousTasks);
      setSyncMessage(`Update failed: ${error.message}`);
      return false;
    }
    return true;
  };

  const persistBatchPositions = async (nextTasks: TaskItem[], previousTasks: TaskItem[]) => {
    if (!supabase) {
      return true;
    }

    const client = supabase;
    const changed = nextTasks.filter((task) => {
      const previous = previousTasks.find((entry) => entry.id === task.id);
      return previous && (previous.scheduled_date !== task.scheduled_date || previous.start_minutes !== task.start_minutes);
    });

    const results = await Promise.all(
      changed.map((task) =>
        client
          .from('schedule_items')
          .update({ scheduled_date: task.scheduled_date, start_minutes: task.start_minutes })
          .eq('id', task.id),
      ),
    );

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setTasks(previousTasks);
      setSyncMessage(`Update failed: ${failed.error.message}`);
      return false;
    }
    return true;
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft.title.trim() || draft.duration <= 0) {
      setStatusMessage('Add a task name and a positive duration first.');
      return;
    }

    const placement = findPlacement(
      tasks,
      { duration: draft.duration, deadline: draft.deadline || undefined },
      selectedDate,
      AUTO_START_MINUTES,
    );

    if (!placement) {
      setStatusMessage('No open slot was found in the current scheduling window.');
      return;
    }

    const item: TaskItem = {
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      description: '',
      type: draft.type,
      priority: draft.priority,
      duration: draft.duration,
      deadline: draft.deadline || undefined,
      scheduled_date: placement.scheduled_date,
      start_minutes: placement.start_minutes,
      done: false,
    };

    setTasks((prev) => sortTasksChronologically([...prev, item]));
    focusDate(item.scheduled_date);
    setView('planner');
    setStatusMessage(
      `${item.title} placed on ${formatDate(item.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatTime(
        item.start_minutes,
      )}${placement.afterDeadline ? ' after its deadline window.' : '.'}`,
    );
    setDraft((prev) => ({ ...prev, title: '', duration: 60, deadline: item.scheduled_date }));

    if (!supabase) {
      return;
    }

    const { error } = await supabase.from('schedule_items').insert(item);
    if (error) {
      setSyncMessage(`Insert failed: ${error.message}`);
      setTasks((prev) => prev.filter((entry) => entry.id !== item.id));
    }
  };

  const toggleTask = async (id: string) => {
    const previousTasks = tasks;
    const target = tasks.find((task) => task.id === id);
    if (!target) {
      return;
    }

    const nextDone = !target.done;
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, done: nextDone } : task)));
    setStatusMessage(`${target.title} marked ${nextDone ? 'complete' : 'active'}.`);
    await persistTaskUpdate(id, { done: nextDone }, previousTasks);
  };

  const moveTask = async (taskId: string, dateKey: string, startMinutes: number) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    const previousTasks = tasks;
    const desiredStart = clampStart(startMinutes, task.duration);
    const collision = findConflict(tasks, dateKey, desiredStart, task.duration, task.id);
    const placement = collision
      ? findPlacement(tasks, { duration: task.duration, deadline: task.deadline }, dateKey, desiredStart, task.id)
      : { scheduled_date: dateKey, start_minutes: desiredStart, afterDeadline: Boolean(task.deadline && dateKey > task.deadline) };

    if (!placement) {
      setStatusMessage(`No open slot found for ${task.title}.`);
      return;
    }

    const nextTasks = sortTasksChronologically(
      tasks.map((entry) =>
        entry.id === taskId
          ? {
              ...entry,
              scheduled_date: placement.scheduled_date,
              start_minutes: placement.start_minutes,
            }
          : entry,
      ),
    );

    setTasks(nextTasks);
    focusDate(placement.scheduled_date);
    setStatusMessage(
      collision
        ? `${task.title} was snapped to ${formatTime(placement.start_minutes)} on ${formatDate(placement.scheduled_date, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })} to avoid overlap${placement.afterDeadline ? ', after its deadline window.' : '.'}`
        : `${task.title} moved to ${formatTime(placement.start_minutes)}${placement.afterDeadline ? ' after its deadline window.' : '.'}`,
    );

    await persistTaskUpdate(
      taskId,
      { scheduled_date: placement.scheduled_date, start_minutes: placement.start_minutes },
      previousTasks,
    );
  };

  const handleBoardDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/task-id') || draggedTaskId;
    if (!taskId) {
      return;
    }

    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left - TIME_GUTTER;
    const dayWidth = Math.max((bounds.width - TIME_GUTTER) / 7, 1);
    const dayIndex = Math.max(0, Math.min(6, Math.floor(relativeX / dayWidth)));
    const startMinutes = clampStart(((event.clientY - bounds.top) / PIXELS_PER_MINUTE) + VISIBLE_START_MINUTES, task.duration);
    await moveTask(taskId, weekDates[dayIndex], startMinutes);
    setDraggedTaskId(null);
  };

  const handleAutoPlaceDay = async () => {
    const previousTasks = tasks;
    const result = autoPlaceDay(tasks, selectedDate);
    setTasks(result.tasks);
    setStatusMessage(
      result.unresolved > 0
        ? `${result.moved} task(s) repositioned. ${result.unresolved} still could not be packed cleanly.`
        : result.moved > 0
          ? `${result.moved} task(s) repositioned by priority and available space.`
          : 'Selected day is already packed cleanly.',
    );
    await persistBatchPositions(result.tasks, previousTasks);
  };

  const renderPriorityCard = (task: TaskItem, compact = false) => (
    <article
      key={task.id}
      className={`priority-card priority-${taskBucket(task, todayKey)} ${compact ? 'compact' : ''}`}
      onClick={() => {
        focusDate(task.scheduled_date);
        setView('planner');
      }}
    >
      <div className="priority-card__accent" />
      <div className="priority-card__content">
        <div className="priority-card__top">
          <div>
            <span className="priority-card__group">{taskTypeLabel(task.type)}</span>
            <strong>{task.title}</strong>
          </div>
          <button
            type="button"
            className="icon-btn subtle"
            onClick={(event) => {
              event.stopPropagation();
              void toggleTask(task.id);
            }}
          >
            {task.done ? 'Undo' : 'Done'}
          </button>
        </div>
        <p>
          {formatDate(task.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' })} · {formatRange(task.start_minutes, task.duration)}
        </p>
        <div className="priority-card__meta">
          <span>{task.priority} priority</span>
          <span>{task.duration} mins</span>
          {task.deadline ? <span>due {formatDate(task.deadline, { month: 'short', day: 'numeric' })}</span> : null}
        </div>
      </div>
    </article>
  );

  return (
    <div className="reclaim-shell">
      <aside className="reclaim-sidebar">
        <div className="brand">
          <div className="brand__mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>goodcalendar</strong>
            <small>planner</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navPrimary.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {navSecondary.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="nav-group">
                <div className="nav-item static">
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.children ? <ChevronDown size={14} /> : null}
                </div>
                {item.children ? (
                  <div className="nav-children">
                    {item.children.map((child) => (
                      <div key={child} className="nav-child">
                        {child}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <div className="workspace-banner">
          <span>Priority-aware planning with drag-and-drop scheduling and automatic placement.</span>
          <button type="button" className="banner-pill">
            {loading ? 'Syncing' : hasSupabaseConfig ? 'Supabase live' : 'Local mode'}
          </button>
        </div>

        <header className="workspace-header">
          <div>
            <h1>{view === 'planner' ? 'Planner' : 'Priorities'}</h1>
            <p>{statusMessage}</p>
          </div>
          <div className="header-actions">
            <button type="button" className="ghost-btn" onClick={() => void handleAutoPlaceDay()}>
              Find a time
            </button>
            <button type="button" className="ghost-btn" onClick={() => focusDate(todayKey)}>
              Today
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setView('planner');
                setRailTab('tasks');
              }}
            >
              <Plus size={16} />
              New Task
            </button>
          </div>
        </header>

        {view === 'planner' ? (
          <section className="planner-view">
            <div className="planner-main">
              <section className="planner-surface">
                <div className="planner-surface__header">
                  <div>
                    <h2>{formatDate(weekDates[0], { month: 'long', year: 'numeric' })}</h2>
                    <p>{syncMessage}</p>
                  </div>
                  <div className="surface-actions">
                    <button type="button" className="icon-btn" onClick={() => shiftWeek(-7)}>
                      <ChevronLeft size={16} />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => shiftWeek(7)}>
                      <ChevronRight size={16} />
                    </button>
                    <button type="button" className="icon-btn">
                      <CircleHelp size={16} />
                    </button>
                  </div>
                </div>

                <div className="focus-strip">
                  <div className="focus-strip__bar">
                    <span style={{ width: `${(weeklyFocusMinutes / capacityMinutes) * 100}%` }} className="focus-segment focus" />
                    <span style={{ width: `${(weeklyTaskMinutes / capacityMinutes) * 100}%` }} className="focus-segment task" />
                    <span style={{ width: `${(weeklyBufferMinutes / capacityMinutes) * 100}%` }} className="focus-segment buffer" />
                    <span style={{ width: `${(freeMinutes / capacityMinutes) * 100}%` }} className="focus-segment free" />
                  </div>
                  <div className="focus-strip__legend">
                    <span><i className="focus" /> Focus target {Math.round(weeklyFocusMinutes / 60)}h</span>
                    <span><i className="task" /> Tasks {Math.round(weeklyTaskMinutes / 60)}h</span>
                    <span><i className="buffer" /> Buffers {Math.round(weeklyBufferMinutes / 60)}h</span>
                    <span><i className="free" /> Free {Math.round(freeMinutes / 60)}h</span>
                  </div>
                </div>

                <div className="week-board">
                  <div className="week-board__header">
                    <div className="timezone-chip">GMT+8</div>
                    {weekDates.map((dateKey) => (
                      <button
                        key={dateKey}
                        type="button"
                        className={`week-day ${selectedDate === dateKey ? 'active' : ''}`}
                        onClick={() => focusDate(dateKey)}
                      >
                        <span>{formatDate(dateKey, { weekday: 'short' })}</span>
                        <strong>{formatDate(dateKey, { day: 'numeric' })}</strong>
                      </button>
                    ))}
                  </div>

                  <div
                    className="week-board__body"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void handleBoardDrop(event)}
                  >
                    <div className="week-board__columns">
                      {weekDates.map((dateKey) => (
                        <div key={dateKey} className={`week-column ${selectedDate === dateKey ? 'active' : ''}`} />
                      ))}
                    </div>

                    {hourMarkers.map((marker) => (
                      <div key={marker} className="hour-line" style={{ top: `${(marker - VISIBLE_START_MINUTES) * PIXELS_PER_MINUTE}px` }}>
                        <span>{formatTime(marker)}</span>
                        <div />
                      </div>
                    ))}

                    {weekTasks.map((task) => {
                      const dayIndex = weekDates.indexOf(task.scheduled_date);
                      if (dayIndex === -1) return null;
                      return (
                        <article
                          key={task.id}
                          className={`week-task type-${task.type} priority-${taskBucket(task, todayKey)} ${task.done ? 'done' : ''}`}
                          style={{
                            top: `${(task.start_minutes - VISIBLE_START_MINUTES) * PIXELS_PER_MINUTE}px`,
                            left: `calc(${TIME_GUTTER}px + ${dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 6px)`,
                            width: `calc((100% - ${TIME_GUTTER}px) / 7 - 12px)`,
                            height: `${Math.max(task.duration * PIXELS_PER_MINUTE, 38)}px`,
                          }}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/task-id', task.id);
                            setDraggedTaskId(task.id);
                          }}
                          onDragEnd={() => setDraggedTaskId(null)}
                        >
                          <strong>{task.title}</strong>
                          <p>{formatRange(task.start_minutes, task.duration)}</p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>

            <aside className="planner-rail">
              <section className="rail-panel rail-panel--composer">
                <div className="rail-heading">
                  <strong>New task</strong>
                  <span>{formatDate(selectedDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
                <form className="task-form" onSubmit={createTask}>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Search or create a task…"
                  />
                  <div className="task-form__row">
                    <select
                      value={draft.priority}
                      onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))}
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as TaskType }))}
                    >
                      <option value="task">Task</option>
                      <option value="focus">Focus</option>
                      <option value="buffer">Buffer</option>
                    </select>
                  </div>
                  <div className="task-form__row">
                    <input
                      type="number"
                      min={15}
                      step={15}
                      value={draft.duration}
                      onChange={(event) => setDraft((prev) => ({ ...prev, duration: Number(event.target.value) }))}
                    />
                    <input
                      type="date"
                      value={draft.deadline}
                      onChange={(event) => setDraft((prev) => ({ ...prev, deadline: event.target.value }))}
                    />
                  </div>
                  <button type="submit" className="primary-btn wide">
                    Add task
                  </button>
                </form>
              </section>

              <section className="rail-panel">
                <div className="rail-tabs">
                  <button type="button" className={railTab === 'priorities' ? 'active' : ''} onClick={() => setRailTab('priorities')}>
                    Priorities
                  </button>
                  <button type="button" className={railTab === 'tasks' ? 'active' : ''} onClick={() => setRailTab('tasks')}>
                    Tasks
                  </button>
                </div>

                <label className="search-field">
                  <Search size={15} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for something…" />
                </label>

                {warnings.length > 0 ? (
                  <div className="warning-stack">
                    {warnings.slice(0, 3).map((warning) => (
                      <article key={warning.id} className={`warning-pill ${warning.severity}`}>
                        <strong>{warning.title}</strong>
                        <p>{warning.detail}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                {railTab === 'priorities' ? (
                  <div className="priority-groups compact">
                    {bucketOrder.map((bucket) => (
                      <section key={bucket} className="priority-group">
                        <div className="priority-group__header">
                          <span>{bucket === 'critical' ? 'Critical' : `${bucket[0].toUpperCase()}${bucket.slice(1)} priority`}</span>
                          <small>{groupedTasks[bucket].length || 'No items'}</small>
                        </div>
                        {groupedTasks[bucket].length === 0 ? (
                          <p className="empty-note">No items</p>
                        ) : (
                          groupedTasks[bucket].slice(0, 4).map((task) => renderPriorityCard(task, true))
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="task-list">
                    {selectedDayItems.length === 0 ? (
                      <p className="empty-note">No tasks scheduled for this day.</p>
                    ) : (
                      selectedDayItems.map((task) => (
                        <article key={task.id} className="scheduled-item">
                          <div>
                            <strong>{task.title}</strong>
                            <p>{formatRange(task.start_minutes, task.duration)}</p>
                          </div>
                          <button type="button" className="icon-btn subtle" onClick={() => void toggleTask(task.id)}>
                            {task.done ? 'Undo' : 'Done'}
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                )}
              </section>
            </aside>
          </section>
        ) : (
          <section className="priorities-view">
            <div className="priorities-toolbar">
              <label className="search-field wide">
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for something…" />
              </label>
              <div className="toolbar-links">
                <button type="button" className="ghost-link">Filter</button>
                <button type="button" className="ghost-link">Columns</button>
                <button type="button" className="ghost-link">Help</button>
              </div>
            </div>

            <div className="priority-board">
              {bucketOrder.map((bucket) => (
                <section key={bucket} className="priority-column">
                  <div className="priority-column__header">
                    <strong>{bucket === 'critical' ? 'Critical' : `${bucket[0].toUpperCase()}${bucket.slice(1)} priority`}</strong>
                    <span>{groupedTasks[bucket].length ? `${groupedTasks[bucket].length} item${groupedTasks[bucket].length > 1 ? 's' : ''}` : 'No items'}</span>
                  </div>
                  {groupedTasks[bucket].length === 0 ? (
                    <p className="empty-note">No items</p>
                  ) : (
                    groupedTasks[bucket].map((task) => renderPriorityCard(task))
                  )}
                </section>
              ))}
            </div>
          </section>
        )}

        <footer className="workspace-footer">
          <div className="footer-status">
            <span className={`status-dot ${hasSupabaseConfig ? 'online' : 'offline'}`} />
            <span>{loading ? 'Loading schedule…' : syncMessage}</span>
          </div>
          <div className="footer-metrics">
            <span>{Math.round(weeklyFocusMinutes / 60)}h focus</span>
            <span>{completionRate}% complete</span>
            <button type="button" className="ghost-link">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
