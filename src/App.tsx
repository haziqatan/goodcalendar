import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
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

const starterTasks: TaskItem[] = [
  {
    id: 'starter-1',
    title: 'Deep work block',
    type: 'focus',
    priority: 'high',
    duration: 120,
    deadline: toDateKey(new Date()),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 9 * 60,
    done: false,
  },
  {
    id: 'starter-2',
    title: 'Prepare client follow-up',
    type: 'task',
    priority: 'medium',
    duration: 45,
    deadline: addDays(toDateKey(new Date()), 1),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 12 * 60 + 30,
    done: false,
  },
];

interface TaskDraft {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  deadline: string;
}

const hourMarkers = Array.from({ length: 24 }, (_, hour) => hour * 60);

function normalizeTask(task: TaskItem) {
  return {
    ...task,
    description: task.description ?? '',
  };
}

export default function App() {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [tasks, setTasks] = useState<TaskItem[]>(hasSupabaseConfig ? [] : starterTasks);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(
    hasSupabaseConfig ? 'Connecting to Supabase schedule…' : 'Local mode only. Add Supabase env vars to sync across devices.',
  );
  const [statusMessage, setStatusMessage] = useState('Drag tasks on the calendar to reschedule them.');
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
        setSyncMessage(normalized.length === 0 ? 'Supabase connected. Your schedule is empty.' : 'Supabase connected.');
      }
      setLoading(false);
    };
    void load();
  }, []);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toDateKey(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index))),
    [weekStart],
  );

  const dayItems = useMemo(
    () => sortTasksChronologically(tasks.filter((task) => task.scheduled_date === selectedDate)),
    [selectedDate, tasks],
  );

  const warnings = useMemo<ScheduleWarning[]>(
    () => buildWarnings(tasks, todayKey, selectedDate),
    [selectedDate, tasks, todayKey],
  );

  const scheduledMinutes = useMemo(
    () => dayItems.reduce((sum, task) => sum + task.duration, 0),
    [dayItems],
  );

  const completionCount = useMemo(
    () => tasks.filter((task) => task.done).length,
    [tasks],
  );

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

    const changed = nextTasks.filter((task) => {
      const previous = previousTasks.find((entry) => entry.id === task.id);
      return previous && (previous.scheduled_date !== task.scheduled_date || previous.start_minutes !== task.start_minutes);
    });

    const results = await Promise.all(
      changed.map((task) =>
        supabase
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
      setStatusMessage('No open slot was found in the current auto-placement window.');
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

  const handleCalendarDrop = async (event: DragEvent<HTMLDivElement>) => {
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
    const offsetY = event.clientY - bounds.top;
    const startMinutes = clampStart(offsetY / PIXELS_PER_MINUTE, task.duration);
    await moveTask(taskId, selectedDate, startMinutes);
    setDraggedTaskId(null);
  };

  const handleDayDrop = async (event: DragEvent<HTMLButtonElement>, dateKey: string) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/task-id') || draggedTaskId;
    if (!taskId) {
      return;
    }

    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    await moveTask(taskId, dateKey, task.start_minutes);
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

  return (
    <main className="planner-shell">
      <section className="planner-topbar">
        <div>
          <p className="eyebrow">GoodCalendar</p>
          <h1>{formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
          <p className="subtle-copy">
            {dayItems.length} items scheduled, {Math.round(scheduledMinutes / 60 * 10) / 10} hours booked, {completionCount} completed overall.
          </p>
        </div>
        <div className="topbar-status">
          <div>
            <strong>{loading ? 'Syncing…' : hasSupabaseConfig ? 'Supabase live' : 'Local mode'}</strong>
            <p>{syncMessage}</p>
          </div>
          <button type="button" className="secondary-btn" onClick={() => focusDate(todayKey)}>
            Today
          </button>
        </div>
      </section>

      <section className="week-nav">
        <div className="week-nav__header">
          <button type="button" className="secondary-btn" onClick={() => shiftWeek(-7)}>
            Previous
          </button>
          <strong>{formatDate(toDateKey(weekStart), { month: 'long', day: 'numeric' })} week</strong>
          <button type="button" className="secondary-btn" onClick={() => shiftWeek(7)}>
            Next
          </button>
        </div>
        <div className="week-nav__days">
          {weekDates.map((dateKey) => {
            const dayCount = tasks.filter((task) => task.scheduled_date === dateKey && !task.done).length;
            return (
              <button
                key={dateKey}
                type="button"
                className={`day-chip ${selectedDate === dateKey ? 'active' : ''}`}
                onClick={() => focusDate(dateKey)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleDayDrop(event, dateKey)}
              >
                <span>{formatDate(dateKey, { weekday: 'short' })}</span>
                <strong>{formatDate(dateKey, { day: 'numeric' })}</strong>
                <small>{dayCount} open</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="planner-grid">
        <aside className="planner-sidebar">
          <form className="panel composer-panel" onSubmit={createTask}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Quick Add</p>
                <h2>Auto-place a task</h2>
              </div>
              <button type="submit" className="primary-btn">
                Add task
              </button>
            </div>

            <label>
              Task
              <input
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Design review, focus block, buffer…"
              />
            </label>

            <div className="field-row">
              <label>
                Duration
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={draft.duration}
                  onChange={(event) => setDraft((prev) => ({ ...prev, duration: Number(event.target.value) }))}
                />
              </label>
              <label>
                Type
                <select
                  value={draft.type}
                  onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as TaskType }))}
                >
                  <option value="task">Task</option>
                  <option value="focus">Focus</option>
                  <option value="buffer">Buffer</option>
                </select>
              </label>
            </div>

            <div className="field-row">
              <label>
                Priority
                <select
                  value={draft.priority}
                  onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                Deadline
                <input
                  type="date"
                  value={draft.deadline}
                  onChange={(event) => setDraft((prev) => ({ ...prev, deadline: event.target.value }))}
                />
              </label>
            </div>

            <p className="helper-text">
              New items start from the selected day and snap into the next free opening. If the day is blocked, the planner rolls forward and warns if it had to place after the deadline.
            </p>
          </form>

          <section className="panel action-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Automation</p>
                <h2>Repack the day</h2>
              </div>
              <button type="button" className="secondary-btn" onClick={() => void handleAutoPlaceDay()}>
                Auto-place day
              </button>
            </div>
            <p className="helper-text">{statusMessage}</p>
          </section>

          <section className="panel warnings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Deadline Warnings</p>
                <h2>Priority-aware alerts</h2>
              </div>
            </div>
            {warnings.length === 0 ? (
              <p className="empty-copy">No deadline or conflict warnings right now.</p>
            ) : (
              <div className="warning-list">
                {warnings.map((warning) => (
                  <article key={warning.id} className={`warning-card ${warning.severity}`}>
                    <strong>{warning.title}</strong>
                    <p>{warning.detail}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="panel calendar-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Daily Calendar</p>
              <h2>Drag and drop to reschedule</h2>
            </div>
            <p className="helper-text">Drop onto the time grid or onto another day chip above.</p>
          </div>

          <div
            className="calendar-grid"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleCalendarDrop(event)}
          >
            {hourMarkers.map((marker) => (
              <div key={marker} className="hour-row" style={{ top: `${marker * PIXELS_PER_MINUTE}px` }}>
                <span>{formatTime(marker)}</span>
                <div />
              </div>
            ))}

            {dayItems.map((item) => (
              <article
                key={item.id}
                className={`calendar-item ${item.type} priority-${item.priority} ${item.done ? 'done' : ''}`}
                style={{
                  top: `${item.start_minutes * PIXELS_PER_MINUTE}px`,
                  height: `${Math.max(item.duration * PIXELS_PER_MINUTE, 44)}px`,
                }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/task-id', item.id);
                  setDraggedTaskId(item.id);
                }}
                onDragEnd={() => setDraggedTaskId(null)}
              >
                <div className="calendar-item__header">
                  <div>
                    <strong>{item.title}</strong>
                    <p>{formatRange(item.start_minutes, item.duration)}</p>
                  </div>
                  <button type="button" className="toggle-btn" onClick={() => void toggleTask(item.id)}>
                    {item.done ? 'Reopen' : 'Done'}
                  </button>
                </div>
                <div className="calendar-item__meta">
                  <span>{item.type}</span>
                  <span>{item.priority} priority</span>
                  {item.deadline ? <span>due {formatDate(item.deadline, { month: 'short', day: 'numeric' })}</span> : null}
                </div>
                {item.deadline && item.scheduled_date > item.deadline ? <small>Scheduled after deadline</small> : null}
              </article>
            ))}

            {dayItems.length === 0 ? (
              <div className="calendar-empty">
                <strong>No tasks scheduled for this day.</strong>
                <p>Add a task on the left and it will auto-place into the next available slot.</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
