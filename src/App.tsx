import { useEffect, useMemo, useRef, useState } from 'react';
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
  MinusCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  PlusCircle,
  Search,
  Settings2,
  SmilePlus,
  Users,
  X,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import {
  AUTO_START_MINUTES,
  AUTO_END_MINUTES,
  PIXELS_PER_MINUTE,
  addDays,
  autoPlaceDay,
  buildScheduleBlocks,
  buildWarnings,
  clampStart,
  findConflict,
  findPlacement,
  formatDate,
  formatDisplayRange,
  formatDisplayTime,
  formatTime,
  fromDateKey,
  isFlexibleTask,
  isWithinTaskWindows,
  sortTasksChronologically,
  startOfWeek,
  toDateKey,
} from './lib/scheduler';
import type { ScheduleBlock, ScheduleWarning, TaskItem, TaskPriority, TaskType, TimeRange } from './types';

type ViewMode = 'planner' | 'priorities';
type RailTab = 'priorities' | 'tasks';
type PriorityBucket = 'critical' | TaskPriority;
type PresetKind = 'working' | 'personal' | 'custom';
type TaskGroupType = TaskType;

interface HourPreset {
  id: string;
  name: string;
  ranges: TimeRange[];
  kind: PresetKind;
}

interface TaskDraft {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  flexible: boolean;
  minDuration: number;
  maxDuration: number;
  hourPresetId: string;
  scheduleAfter: string;
  deadline: string;
  description: string;
}

interface EmojiClickDetail {
  unicode: string;
}

const HOURS_STORAGE_KEY = 'goodcalendar-hour-presets';
const TIME_GUTTER = 80;
const DURATION_STEP = 15;
const BOARD_TOP_PADDING = 18;
const DEFAULT_HOUR_PRESETS: HourPreset[] = [
  {
    id: 'working-hours',
    name: 'Working Hours',
    ranges: [
      { start_minutes: 8 * 60, end_minutes: 13 * 60 },
      { start_minutes: 14 * 60, end_minutes: 18 * 60 },
    ],
    kind: 'working',
  },
  {
    id: 'personal-hours',
    name: 'Personal Hours',
    ranges: [
      { start_minutes: 18 * 60, end_minutes: 22 * 60 },
    ],
    kind: 'personal',
  },
];

const starterTasks: TaskItem[] = [
  {
    id: 'starter-1',
    title: '🍱 Lunch',
    type: 'task',
    priority: 'high',
    duration: 60,
    min_duration: 30,
    max_duration: 60,
    hour_preset: 'Working Hours',
    hours_start: 8 * 60,
    hours_end: 18 * 60,
    hours_ranges: [
      { start_minutes: 8 * 60, end_minutes: 13 * 60 },
      { start_minutes: 14 * 60, end_minutes: 18 * 60 },
    ],
    schedule_after: toDateKey(new Date()),
    deadline: addDays(toDateKey(new Date()), 1),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 11 * 60 + 45,
    done: false,
    description: 'Team lunch block',
  },
  {
    id: 'starter-2',
    title: 'Lunch Hour',
    type: 'buffer',
    priority: 'medium',
    duration: 75,
    hour_preset: 'Working Hours',
    hours_start: 8 * 60,
    hours_end: 18 * 60,
    hours_ranges: [
      { start_minutes: 8 * 60, end_minutes: 13 * 60 },
      { start_minutes: 14 * 60, end_minutes: 18 * 60 },
    ],
    schedule_after: toDateKey(new Date()),
    deadline: toDateKey(new Date()),
    scheduled_date: toDateKey(new Date()),
    start_minutes: 12 * 60 + 45,
    done: false,
  },
  {
    id: 'starter-3',
    title: '🧠 Deep work',
    type: 'focus',
    priority: 'high',
    duration: 120,
    min_duration: 60,
    max_duration: 150,
    hour_preset: 'Working Hours',
    hours_start: 8 * 60,
    hours_end: 18 * 60,
    hours_ranges: [
      { start_minutes: 8 * 60, end_minutes: 13 * 60 },
      { start_minutes: 14 * 60, end_minutes: 18 * 60 },
    ],
    schedule_after: addDays(toDateKey(new Date()), 1),
    deadline: addDays(toDateKey(new Date()), 2),
    scheduled_date: addDays(toDateKey(new Date()), 1),
    start_minutes: 13 * 60,
    done: false,
    description: 'Sprint planning follow-up',
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

const bucketOrder: PriorityBucket[] = ['critical', 'high', 'medium', 'low'];
const taskGroupOrder: TaskGroupType[] = ['buffer', 'task', 'focus'];

function normalizeRanges(ranges?: Array<Partial<TimeRange> | null | undefined>) {
  const normalized = (ranges ?? [])
    .map((range) => ({
      start_minutes: Math.max(0, Math.min(24 * 60, Math.round((range?.start_minutes ?? 0) / DURATION_STEP) * DURATION_STEP)),
      end_minutes: Math.max(0, Math.min(24 * 60, Math.round((range?.end_minutes ?? 0) / DURATION_STEP) * DURATION_STEP)),
    }))
    .filter((range) => range.end_minutes > range.start_minutes)
    .sort((left, right) => left.start_minutes - right.start_minutes);

  return normalized.length > 0
    ? normalized
    : [{ start_minutes: AUTO_START_MINUTES, end_minutes: AUTO_END_MINUTES }];
}

function rangeBounds(ranges?: Array<Partial<TimeRange> | null | undefined>) {
  const normalized = normalizeRanges(ranges);
  return {
    start_minutes: normalized[0].start_minutes,
    end_minutes: normalized[normalized.length - 1].end_minutes,
  };
}

function normalizePreset(preset: Partial<HourPreset> & { id: string; name?: string; kind?: PresetKind; start_minutes?: number; end_minutes?: number }) {
  const fallbackRanges =
    preset.ranges && preset.ranges.length > 0
      ? preset.ranges
      : [{ start_minutes: preset.start_minutes ?? AUTO_START_MINUTES, end_minutes: preset.end_minutes ?? AUTO_END_MINUTES }];

  return {
    id: preset.id,
    name: preset.name ?? 'Hours',
    kind: preset.kind ?? 'custom',
    ranges: normalizeRanges(fallbackRanges),
  } satisfies HourPreset;
}

function presetSummary(preset: HourPreset) {
  return preset.ranges.map((range) => formatDisplayRange(range.start_minutes, range.end_minutes - range.start_minutes)).join(', ');
}

function rangesMatch(left: TimeRange[] | undefined, right: TimeRange[] | undefined) {
  const normalizedLeft = normalizeRanges(left);
  const normalizedRight = normalizeRanges(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every(
    (range, index) =>
      range.start_minutes === normalizedRight[index].start_minutes &&
      range.end_minutes === normalizedRight[index].end_minutes,
  );
}

function normalizeTask(task: TaskItem) {
  const ranges =
    task.hours_ranges && task.hours_ranges.length > 0
      ? normalizeRanges(task.hours_ranges)
      : normalizeRanges([{ start_minutes: task.hours_start, end_minutes: task.hours_end }]);
  const bounds = rangeBounds(ranges);

  return {
    ...task,
    description: task.description ?? '',
    priority: task.priority ?? 'high',
    hours_ranges: ranges,
    hours_start: task.hours_start ?? bounds.start_minutes,
    hours_end: task.hours_end ?? bounds.end_minutes,
  };
}

function taskBucket(task: TaskItem, _todayKey: string): PriorityBucket {
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
  if (type === 'focus') return 'Focus Time';
  if (type === 'buffer') return 'Habits';
  return 'Tasks';
}

function buildCompactSectionKey(bucket: PriorityBucket, type: TaskGroupType) {
  return `${bucket}:${type}`;
}

function clampDuration(value: number) {
  return Math.max(DURATION_STEP, Math.round(value / DURATION_STEP) * DURATION_STEP);
}

function minutesToTimeInput(value: number) {
  return formatTime(value);
}

function timeInputToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

function buildDraft(selectedDate: string, hourPresetId: string): TaskDraft {
  return {
    title: '',
    type: 'task',
    priority: 'high',
    duration: 60,
    flexible: false,
    minDuration: 30,
    maxDuration: 120,
    hourPresetId,
    scheduleAfter: selectedDate,
    deadline: selectedDate,
    description: '',
  };
}

function buildDraftFromTask(task: TaskItem, hourPresetId: string): TaskDraft {
  return {
    title: task.title,
    type: task.type,
    priority: task.priority,
    duration: task.duration,
    flexible: Boolean(task.min_duration || task.max_duration),
    minDuration: task.min_duration ?? Math.min(task.duration, 30),
    maxDuration: task.max_duration ?? Math.max(task.duration, 120),
    hourPresetId,
    scheduleAfter: task.schedule_after ?? task.scheduled_date,
    deadline: task.deadline ?? task.scheduled_date,
    description: task.description ?? '',
  };
}

export default function App() {
  const todayKey = toDateKey(new Date());
  const [view, setView] = useState<ViewMode>('planner');
  const [railTab, setRailTab] = useState<RailTab>('priorities');
  const [query, setQuery] = useState('');
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [hourPresets, setHourPresets] = useState<HourPreset[]>(DEFAULT_HOUR_PRESETS);
  const [tasks, setTasks] = useState<TaskItem[]>(hasSupabaseConfig ? [] : starterTasks);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(
    hasSupabaseConfig ? 'Connecting to Supabase schedule…' : 'Local mode. Add Vercel env vars to sync across devices.',
  );
  const [statusMessage, setStatusMessage] = useState('Drag blocks across the planner to reschedule them.');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draggedPriorityTaskId, setDraggedPriorityTaskId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showHoursSettings, setShowHoursSettings] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [collapsedCompactSections, setCollapsedCompactSections] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<TaskDraft>(buildDraft(todayKey, DEFAULT_HOUR_PRESETS[0].id));
  const emojiPickerHostRef = useRef<HTMLDivElement | null>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const emojiPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem(HOURS_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as HourPreset[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map((preset) => normalizePreset(preset));
        setHourPresets(normalized);
        setDraft((current) => ({
          ...current,
          hourPresetId: normalized.some((preset) => preset.id === current.hourPresetId) ? current.hourPresetId : normalized[0].id,
        }));
      }
    } catch {
      window.localStorage.removeItem(HOURS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(HOURS_STORAGE_KEY, JSON.stringify(hourPresets));
  }, [hourPresets]);

  useEffect(() => {
    if (!showEmojiPicker || !emojiPickerHostRef.current || typeof window === 'undefined') {
      return;
    }

    if (!window.customElements.get('emoji-picker')) {
      return;
    }

    const host = emojiPickerHostRef.current;
    host.innerHTML = '';
    const picker = document.createElement('emoji-picker');

    const handleEmojiClick = (event: Event) => {
      const detail = (event as CustomEvent<EmojiClickDetail>).detail;
      const emoji = detail?.unicode;
      if (!emoji) {
        return;
      }

      setDraft((prev) => ({
        ...prev,
        title: prev.title ? `${prev.title} ${emoji}` : emoji,
      }));
      setShowEmojiPicker(false);
    };

    picker.addEventListener('emoji-click', handleEmojiClick as EventListener);
    host.appendChild(picker);

    return () => {
      picker.removeEventListener('emoji-click', handleEmojiClick as EventListener);
      host.innerHTML = '';
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    if (!showEmojiPicker) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (emojiPopoverRef.current?.contains(target) || emojiTriggerRef.current?.contains(target)) {
        return;
      }

      setShowEmojiPicker(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showEmojiPicker]);

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

  const planningStart = useMemo(() => {
    const seeds = [todayKey, weekDates[0], ...tasks.map((task) => task.schedule_after ?? task.scheduled_date)];
    return seeds.reduce((earliest, current) => (current < earliest ? current : earliest));
  }, [tasks, todayKey, weekDates]);

  const planningEnd = useMemo(() => {
    const seeds = [weekDates[6], ...tasks.map((task) => task.deadline ?? task.scheduled_date)];
    const latest = seeds.reduce((currentLatest, current) => (current > currentLatest ? current : currentLatest));
    return addDays(latest, 14);
  }, [tasks, weekDates]);

  const optimizedBlocks = useMemo<ScheduleBlock[]>(
    () => buildScheduleBlocks(tasks, planningStart, planningEnd),
    [tasks, planningStart, planningEnd],
  );

  const blocksByTaskId = useMemo(() => {
    const grouped = new Map<string, ScheduleBlock[]>();
    optimizedBlocks.forEach((block) => {
      const current = grouped.get(block.task_id) ?? [];
      current.push(block);
      grouped.set(block.task_id, current);
    });
    return grouped;
  }, [optimizedBlocks]);

  const weekTasks = useMemo(
    () => optimizedBlocks.filter((block) => weekDates.includes(block.scheduled_date)),
    [optimizedBlocks, weekDates],
  );

  const selectedDayItems = useMemo<ScheduleBlock[]>(
    () => optimizedBlocks.filter((block) => block.scheduled_date === selectedDate).sort((left, right) => left.start_minutes - right.start_minutes),
    [optimizedBlocks, selectedDate],
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

  const compactGroupedTasks = useMemo(() => {
    const grouped: Record<PriorityBucket, Record<TaskGroupType, TaskItem[]>> = {
      critical: { buffer: [], task: [], focus: [] },
      high: { buffer: [], task: [], focus: [] },
      medium: { buffer: [], task: [], focus: [] },
      low: { buffer: [], task: [], focus: [] },
    };

    const compareWithinType = (left: TaskItem, right: TaskItem) => {
      const leftBlock = (blocksByTaskId.get(left.id) ?? [])[0];
      const rightBlock = (blocksByTaskId.get(right.id) ?? [])[0];
      const leftScheduledDate = leftBlock?.scheduled_date ?? left.scheduled_date;
      const rightScheduledDate = rightBlock?.scheduled_date ?? right.scheduled_date;
      if (leftScheduledDate !== rightScheduledDate) {
        return leftScheduledDate.localeCompare(rightScheduledDate);
      }

      const leftStart = leftBlock?.start_minutes ?? left.start_minutes;
      const rightStart = rightBlock?.start_minutes ?? right.start_minutes;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftDeadline = left.deadline ?? '9999-12-31';
      const rightDeadline = right.deadline ?? '9999-12-31';
      if (leftDeadline !== rightDeadline) {
        return leftDeadline.localeCompare(rightDeadline);
      }

      if (left.done !== right.done) {
        return Number(left.done) - Number(right.done);
      }

      return left.title.localeCompare(right.title);
    };

    filteredOpenTasks.forEach((task) => {
      grouped[taskBucket(task, todayKey)][task.type].push(task);
    });

    bucketOrder.forEach((bucket) => {
      taskGroupOrder.forEach((type) => {
        grouped[bucket][type] = [...grouped[bucket][type]].sort(compareWithinType);
      });
    });

    return grouped;
  }, [blocksByTaskId, filteredOpenTasks, todayKey]);

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

  const boardWindow = useMemo(() => {
    const start = 0;
    const end = 24 * 60;
    const markers = Array.from({ length: 24 }, (_, index) => start + index * 60);
    return {
      start,
      end,
      markers,
      height: (end - start) * PIXELS_PER_MINUTE,
    };
  }, []);

  const selectedPreset =
    hourPresets.find((preset) => preset.id === draft.hourPresetId) ??
    hourPresets[0] ??
    DEFAULT_HOUR_PRESETS[0];

  const capacitySource = hourPresets.find((preset) => preset.kind === 'working') ?? selectedPreset;
  const capacityMinutes = 7 * capacitySource.ranges.reduce((sum, range) => sum + (range.end_minutes - range.start_minutes), 0);
  const freeMinutes = Math.max(capacityMinutes - scheduledMinutes, 0);

  const focusDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setWeekStart(startOfWeek(fromDateKey(dateKey)));
  };

  const openTaskModal = () => {
    setEditingTaskId(null);
    setDraft(buildDraft(selectedDate, hourPresets[0]?.id ?? DEFAULT_HOUR_PRESETS[0].id));
    setShowTaskModal(true);
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setEditingTaskId(null);
    setShowEmojiPicker(false);
  };

  const openEditTaskModal = (task: TaskItem) => {
    let presetId =
      hourPresets.find(
        (preset) =>
          (task.hour_preset && preset.name === task.hour_preset) ||
          rangesMatch(preset.ranges, task.hours_ranges),
      )?.id ?? '';

    if (!presetId) {
      const id = `custom-${crypto.randomUUID()}`;
      const ranges = task.hours_ranges && task.hours_ranges.length > 0
        ? normalizeRanges(task.hours_ranges)
        : normalizeRanges([{ start_minutes: task.hours_start, end_minutes: task.hours_end }]);
      const customPreset: HourPreset = {
        id,
        name: task.hour_preset || `Custom Hours ${hourPresets.filter((preset) => preset.kind === 'custom').length + 1}`,
        ranges,
        kind: 'custom',
      };
      setHourPresets((prev) => [...prev, customPreset]);
      presetId = id;
    }

    focusDate(task.scheduled_date);
    setEditingTaskId(task.id);
    setDraft(buildDraftFromTask(task, presetId));
    setShowTaskModal(true);
  };

  const openEditTaskModalById = (taskId: string) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }
    openEditTaskModal(task);
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

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft.title.trim()) {
      setStatusMessage('Task title is required.');
      return;
    }

    const duration = clampDuration(draft.duration);
    const normalizedMinDuration = draft.flexible ? Math.min(clampDuration(Math.min(draft.minDuration, draft.maxDuration)), duration) : undefined;
    const normalizedMaxDuration = draft.flexible
      ? Math.min(Math.max(clampDuration(Math.max(draft.minDuration, draft.maxDuration)), normalizedMinDuration ?? DURATION_STEP), duration)
      : undefined;
    const scheduleAfter = draft.scheduleAfter || selectedDate;
    const preset = hourPresets.find((entry) => entry.id === draft.hourPresetId) ?? selectedPreset;
    const presetRanges = normalizeRanges(preset.ranges);
    const presetBounds = rangeBounds(presetRanges);

    if (presetRanges.length === 0) {
      setStatusMessage('Selected hours need at least one valid time range.');
      return;
    }

    const existingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) : null;
    const placementContext = {
      duration,
      deadline: draft.deadline || undefined,
      schedule_after: scheduleAfter,
      hours_ranges: presetRanges,
      hours_start: presetBounds.start_minutes,
      hours_end: presetBounds.end_minutes,
    };

    let placement = findPlacement(
      tasks,
      placementContext,
      existingTask?.scheduled_date ?? selectedDate,
      existingTask?.start_minutes ?? presetBounds.start_minutes,
      editingTaskId ?? undefined,
    );

    const item: TaskItem = {
      id: editingTaskId ?? crypto.randomUUID(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      type: draft.type,
      priority: draft.priority,
      duration,
      min_duration: normalizedMinDuration,
      max_duration: normalizedMaxDuration,
      hour_preset: preset.name,
      hours_start: presetBounds.start_minutes,
      hours_end: presetBounds.end_minutes,
      hours_ranges: presetRanges,
      schedule_after: scheduleAfter,
      deadline: draft.deadline || undefined,
      scheduled_date: placement?.scheduled_date ?? (existingTask?.scheduled_date ?? scheduleAfter),
      start_minutes: placement?.start_minutes ?? (existingTask?.start_minutes ?? presetBounds.start_minutes),
      done: existingTask?.done ?? false,
    };

    if (isFlexibleTask(item)) {
      const previewTasks = editingTaskId ? tasks.map((task) => (task.id === editingTaskId ? item : task)) : [...tasks, item];
      const previewStartSeeds = [planningStart, item.schedule_after ?? item.scheduled_date];
      const previewStart = previewStartSeeds.reduce((earliest, current) => (current < earliest ? current : earliest));
      const previewEndSeed = item.deadline ?? item.scheduled_date;
      const previewEnd = addDays(previewEndSeed > planningEnd ? previewEndSeed : planningEnd, 14);
      const previewBlocks = buildScheduleBlocks(previewTasks, previewStart, previewEnd).filter((block) => block.task_id === item.id);

      if (previewBlocks.length === 0) {
        setStatusMessage('No open split schedule was found for the selected hours and schedule-after date.');
        return;
      }

      placement = {
        scheduled_date: previewBlocks[0].scheduled_date,
        start_minutes: previewBlocks[0].start_minutes,
        afterDeadline: Boolean(item.deadline && previewBlocks[previewBlocks.length - 1].scheduled_date > item.deadline),
      };
      item.scheduled_date = placement.scheduled_date;
      item.start_minutes = placement.start_minutes;
    } else if (!placement) {
      setStatusMessage('No open slot was found for the selected hours and schedule-after date.');
      return;
    }

    const previousTasks = tasks;
    setTasks((prev) =>
      sortTasksChronologically(
        editingTaskId ? prev.map((task) => (task.id === editingTaskId ? item : task)) : [...prev, item],
      ),
    );
    focusDate(item.scheduled_date);
    setView('planner');
    closeTaskModal();
    setStatusMessage(
      `${item.title} ${editingTaskId ? 'updated' : 'placed'} on ${formatDate(item.scheduled_date, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })} at ${formatDisplayTime(item.start_minutes)}${placement.afterDeadline ? ' after its deadline window.' : '.'}`,
    );

    if (!supabase) {
      return;
    }

    if (editingTaskId) {
      const { error } = await supabase
        .from('schedule_items')
        .update({
          title: item.title,
          description: item.description,
          type: item.type,
          priority: item.priority,
          duration: item.duration,
          min_duration: item.min_duration,
          max_duration: item.max_duration,
          hour_preset: item.hour_preset,
          hours_start: item.hours_start,
          hours_end: item.hours_end,
          hours_ranges: item.hours_ranges,
          schedule_after: item.schedule_after,
          deadline: item.deadline,
          scheduled_date: item.scheduled_date,
          start_minutes: item.start_minutes,
        })
        .eq('id', item.id);
      if (error) {
        setSyncMessage(`Update failed: ${error.message}`);
        setTasks(previousTasks);
      }
      return;
    }

    const { error } = await supabase.from('schedule_items').insert(item);
    if (error) {
      setSyncMessage(`Insert failed: ${error.message}`);
      setTasks(previousTasks);
    }
  };

  const deleteTask = async () => {
    if (!editingTaskId) {
      return;
    }

    const previousTasks = tasks;
    const target = tasks.find((task) => task.id === editingTaskId);
    if (!target) {
      return;
    }

    setTasks((prev) => prev.filter((task) => task.id !== editingTaskId));
    closeTaskModal();
    setStatusMessage(`${target.title} deleted.`);

    if (!supabase) {
      return;
    }

    const { error } = await supabase.from('schedule_items').delete().eq('id', editingTaskId);
    if (error) {
      setSyncMessage(`Delete failed: ${error.message}`);
      setTasks(previousTasks);
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

  const updateTaskPriority = async (id: string, priority: TaskPriority) => {
    const previousTasks = tasks;
    const target = tasks.find((task) => task.id === id);
    if (!target || target.priority === priority) {
      return;
    }

    const nextTasks = sortTasksChronologically(
      tasks.map((task) => (task.id === id ? { ...task, priority } : task)),
    );
    setTasks(nextTasks);
    setStatusMessage(`${target.title} moved to ${priority} priority.`);
    await persistTaskUpdate(id, { priority }, previousTasks);
  };

  const handlePriorityDrop = async (event: DragEvent<HTMLElement>, bucket: PriorityBucket) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/priority-task-id') || draggedPriorityTaskId;
    setDraggedPriorityTaskId(null);
    if (!taskId) {
      return;
    }

    await updateTaskPriority(taskId, bucket);
  };

  const moveTask = async (taskId: string, dateKey: string, startMinutes: number) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    const previousTasks = tasks;
    const desiredStart = clampStart(startMinutes, task.duration);
    const collision = findConflict(tasks, dateKey, desiredStart, task.duration, task.id);
    const outsideWindow = Boolean(task.schedule_after && dateKey < task.schedule_after) || !isWithinTaskWindows(task, desiredStart, task.duration);
    const placement = collision || outsideWindow
      ? findPlacement(
          tasks,
          {
            duration: task.duration,
            deadline: task.deadline,
            schedule_after: task.schedule_after,
            hours_ranges: task.hours_ranges,
            hours_start: task.hours_start,
            hours_end: task.hours_end,
          },
          dateKey,
          desiredStart,
          task.id,
        )
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
      collision || outsideWindow
        ? `${task.title} was snapped to ${formatDisplayTime(placement.start_minutes)} on ${formatDate(placement.scheduled_date, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })} to avoid overlap${placement.afterDeadline ? ', after its deadline window.' : '.'}`
        : `${task.title} moved to ${formatDisplayTime(placement.start_minutes)}${placement.afterDeadline ? ' after its deadline window.' : '.'}`,
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
    const startMinutes = clampStart(
      ((event.clientY - bounds.top + event.currentTarget.scrollTop - BOARD_TOP_PADDING) / PIXELS_PER_MINUTE) + boardWindow.start,
      task.duration,
    );
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

  const updatePreset = (id: string, patch: Partial<HourPreset>) => {
    setHourPresets((prev) => prev.map((preset) => (preset.id === id ? normalizePreset({ ...preset, ...patch }) : preset)));
  };

  const updatePresetRange = (presetId: string, rangeIndex: number, patch: Partial<TimeRange>) => {
    setHourPresets((prev) =>
      prev.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        const nextRanges = preset.ranges.map((range, index) => (index === rangeIndex ? { ...range, ...patch } : range));
        return {
          ...preset,
          ranges: normalizeRanges(nextRanges),
        };
      }),
    );
  };

  const addPresetRange = (presetId: string) => {
    setHourPresets((prev) =>
      prev.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        const lastRange = preset.ranges[preset.ranges.length - 1] ?? { start_minutes: 9 * 60, end_minutes: 12 * 60 };
        const nextStart = Math.min(lastRange.end_minutes + DURATION_STEP, 22 * 60);
        const nextEnd = Math.min(nextStart + 2 * 60, 24 * 60);
        return { ...preset, ranges: normalizeRanges([...preset.ranges, { start_minutes: nextStart, end_minutes: nextEnd }]) };
      }),
    );
  };

  const deletePresetRange = (presetId: string, rangeIndex: number) => {
    setHourPresets((prev) =>
      prev.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        const nextRanges = preset.ranges.filter((_, index) => index !== rangeIndex);
        return { ...preset, ranges: normalizeRanges(nextRanges.length > 0 ? nextRanges : preset.ranges) };
      }),
    );
  };

  const addCustomPreset = () => {
    const id = `custom-${crypto.randomUUID()}`;
    setHourPresets((prev) => [
      ...prev,
      normalizePreset({
        id,
        name: `Custom Hours ${prev.filter((preset) => preset.kind === 'custom').length + 1}`,
        ranges: [{ start_minutes: 9 * 60, end_minutes: 17 * 60 }],
        kind: 'custom',
      }),
    ]);
    setDraft((prev) => ({ ...prev, hourPresetId: id }));
  };

  const deletePreset = (id: string) => {
    const remaining = hourPresets.filter((preset) => preset.id !== id);
    const nextPresets = remaining.length > 0 ? remaining : DEFAULT_HOUR_PRESETS;
    const fallback = nextPresets[0];
    setHourPresets(nextPresets);
    setDraft((current) => ({
      ...current,
      hourPresetId: current.hourPresetId === id ? fallback.id : current.hourPresetId,
    }));
  };

  const toggleCompactSection = (bucket: PriorityBucket, type: TaskGroupType) => {
    const key = buildCompactSectionKey(bucket, type);
    setCollapsedCompactSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const renderPriorityCard = (task: TaskItem, compact = false) => (
    (() => {
      const taskBlocks = blocksByTaskId.get(task.id) ?? [];
      const nextBlock = taskBlocks[0];
      const scheduleLabel = taskBlocks.length > 1 && nextBlock
        ? `${taskBlocks.length} blocks · next ${formatDate(nextBlock.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatDisplayTime(nextBlock.start_minutes)}`
        : `${formatDate(task.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatDisplayRange(task.start_minutes, task.duration)}`;

      return (
        <article
          key={task.id}
          className={`priority-card priority-${taskBucket(task, todayKey)} ${compact ? 'compact' : ''}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/priority-task-id', task.id);
            setDraggedPriorityTaskId(task.id);
          }}
          onDragEnd={() => setDraggedPriorityTaskId(null)}
          onClick={() => {
            openEditTaskModal(task);
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
            <p>{scheduleLabel}</p>
            <div className="priority-card__meta">
              <span>{task.priority} priority</span>
              <span>{task.duration} mins</span>
              {taskBlocks.length > 1 ? <span>split</span> : null}
              {task.hour_preset ? <span>{task.hour_preset}</span> : null}
              {task.deadline ? <span>due {formatDate(task.deadline, { month: 'short', day: 'numeric' })}</span> : null}
            </div>
          </div>
        </article>
      );
    })()
  );

  return (
    <div className={`reclaim-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {sidebarOpen ? (
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
      ) : null}

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{view === 'planner' ? 'Planner' : 'Priorities'}</h1>
            <p>{statusMessage}</p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            {view === 'planner' ? (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setRailOpen((current) => !current)}
                aria-label={railOpen ? 'Hide rail panel' : 'Show rail panel'}
              >
                {railOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            ) : null}
            <button type="button" className="ghost-btn" onClick={() => void handleAutoPlaceDay()}>
              Find a time
            </button>
            <button type="button" className="ghost-btn" onClick={() => focusDate(todayKey)}>
              Today
            </button>
            <button type="button" className="primary-btn" onClick={openTaskModal}>
              <Plus size={16} />
              New Task
            </button>
          </div>
        </header>

        {view === 'planner' ? (
          <section className={`planner-view ${railOpen ? '' : 'rail-collapsed'}`}>
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
                    style={{ height: `${boardWindow.height + BOARD_TOP_PADDING}px` }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void handleBoardDrop(event)}
                  >
                    <div className="week-board__columns">
                      {weekDates.map((dateKey) => (
                        <div key={dateKey} className={`week-column ${selectedDate === dateKey ? 'active' : ''}`} />
                      ))}
                    </div>

                    {boardWindow.markers.map((marker) => (
                      <div key={marker} className="hour-line" style={{ top: `${BOARD_TOP_PADDING + (marker - boardWindow.start) * PIXELS_PER_MINUTE}px` }}>
                        <span>{formatDisplayTime(marker)}</span>
                        <div />
                      </div>
                    ))}

                    {weekTasks.map((task) => {
                      const dayIndex = weekDates.indexOf(task.scheduled_date);
                      if (dayIndex === -1) return null;
                      const sourceTask = tasks.find((entry) => entry.id === task.task_id);
                      const draggable = sourceTask ? !isFlexibleTask(sourceTask) : !task.is_split_segment;
                      return (
                        <article
                          key={task.id}
                          className={`week-task type-${task.type} priority-${taskBucket(task, todayKey)} ${task.done ? 'done' : ''}`}
                          style={{
                            top: `${BOARD_TOP_PADDING + (task.start_minutes - boardWindow.start) * PIXELS_PER_MINUTE}px`,
                            left: `calc(${TIME_GUTTER}px + ${dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 6px)`,
                            width: `calc((100% - ${TIME_GUTTER}px) / 7 - 12px)`,
                            height: `${Math.max(task.duration * PIXELS_PER_MINUTE, 38)}px`,
                          }}
                          draggable={draggable}
                          onDragStart={(event) => {
                            if (!draggable) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer.setData('text/task-id', task.task_id);
                            setDraggedTaskId(task.task_id);
                          }}
                          onDragEnd={() => setDraggedTaskId(null)}
                          onClick={() => openEditTaskModalById(task.task_id)}
                        >
                          <strong>{task.title}{task.is_split_segment && task.segment_count > 1 ? ` • ${task.segment_index}/${task.segment_count}` : ''}</strong>
                          <p>{formatDisplayRange(task.start_minutes, task.duration)}</p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>

            {railOpen ? (
            <aside className="planner-rail">
              <section className="rail-panel">
                <div className="rail-heading">
                  <strong>Selected day</strong>
                  <span>{formatDate(selectedDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
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

                <div className="rail-tabs">
                  <button type="button" className={railTab === 'priorities' ? 'active' : ''} onClick={() => setRailTab('priorities')}>
                    Priorities
                  </button>
                  <button type="button" className={railTab === 'tasks' ? 'active' : ''} onClick={() => setRailTab('tasks')}>
                    Tasks
                  </button>
                </div>

                {railTab === 'priorities' ? (
                  <div className="priority-groups compact">
                    {bucketOrder.map((bucket) => (
                      <section
                        key={bucket}
                        className="priority-group priority-dropzone"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void handlePriorityDrop(event, bucket)}
                      >
                        <div className="priority-group__header">
                          <span>{bucket === 'critical' ? 'Critical' : `${bucket[0].toUpperCase()}${bucket.slice(1)} priority`}</span>
                          <small>{groupedTasks[bucket].length || 'No items'}</small>
                        </div>
                        {groupedTasks[bucket].length === 0 ? (
                          <p className="empty-note">No items</p>
                        ) : (
                          <div className="compact-priority-sections">
                            {taskGroupOrder
                              .filter((type) => compactGroupedTasks[bucket][type].length > 0)
                              .map((type) => {
                                const sectionKey = buildCompactSectionKey(bucket, type);
                                const collapsed = collapsedCompactSections[sectionKey] ?? false;
                                const sectionTasks = compactGroupedTasks[bucket][type];

                                return (
                                  <section key={sectionKey} className="compact-priority-section">
                                    <button
                                      type="button"
                                      className={`compact-section-toggle ${collapsed ? 'collapsed' : ''}`}
                                      onClick={() => toggleCompactSection(bucket, type)}
                                    >
                                      <span>{taskTypeLabel(type)}</span>
                                      <small>{sectionTasks.length}</small>
                                      <ChevronDown size={14} />
                                    </button>
                                    {!collapsed ? (
                                      <div className="compact-section-cards">
                                        {sectionTasks.map((task) => renderPriorityCard(task, true))}
                                      </div>
                                    ) : null}
                                  </section>
                                );
                              })}
                          </div>
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
                        <article key={task.id} className="scheduled-item" onClick={() => openEditTaskModalById(task.task_id)}>
                          <div>
                            <strong>{task.title}{task.is_split_segment && task.segment_count > 1 ? ` • ${task.segment_index}/${task.segment_count}` : ''}</strong>
                            <p>{formatDisplayRange(task.start_minutes, task.duration)}</p>
                          </div>
                          <button
                            type="button"
                            className="icon-btn subtle"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleTask(task.task_id);
                            }}
                          >
                            {task.done ? 'Undo' : 'Done'}
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                )}
              </section>
            </aside>
            ) : null}
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
                <section
                  key={bucket}
                  className="priority-column priority-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void handlePriorityDrop(event, bucket)}
                >
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

      {showTaskModal ? (
        <div className="modal-backdrop" onClick={closeTaskModal}>
          <section className="task-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeTaskModal}>
              <X size={20} />
            </button>

            <form className="task-modal__form" onSubmit={submitTask}>
              <div className="task-modal__title">
                <strong>{editingTaskId ? 'Edit task' : 'New task'}</strong>
                <span>{editingTaskId ? 'Update scheduling details and save changes.' : 'Create a task with scheduling rules and notes.'}</span>
              </div>
              <div className="task-title-field">
                <button
                  ref={emojiTriggerRef}
                  type="button"
                  className="emoji-trigger"
                  onClick={() => setShowEmojiPicker((current) => !current)}
                  aria-label="Open emoji picker"
                >
                  <SmilePlus size={24} />
                </button>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Task name..."
                  autoFocus
                />
                {showEmojiPicker ? (
                  <div ref={emojiPopoverRef} className="emoji-picker-popover">
                    <div ref={emojiPickerHostRef} className="emoji-picker-host" />
                  </div>
                ) : null}
              </div>
              {!draft.title.trim() ? <p className="modal-error">Task title is required</p> : null}

              <div className="priority-row">
                {(['critical', 'high', 'medium', 'low'] as TaskPriority[]).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    className={`priority-pill ${draft.priority === priority ? 'active' : ''} ${priority}`}
                    onClick={() => setDraft((prev) => ({ ...prev, priority }))}
                  >
                    {priority} priority
                  </button>
                ))}
              </div>

              <div className="modal-card modal-card--duration">
                <div>
                  <span>Duration</span>
                  <strong>{draft.duration >= 60 ? `${draft.duration / 60} hr${draft.duration >= 120 ? 's' : ''}` : `${draft.duration} mins`}</strong>
                </div>
                <div className="duration-controls">
                  <button type="button" className="icon-btn" onClick={() => setDraft((prev) => ({ ...prev, duration: clampDuration(prev.duration - DURATION_STEP) }))}>
                    <MinusCircle size={20} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setDraft((prev) => ({ ...prev, duration: clampDuration(prev.duration + DURATION_STEP) }))}>
                    <PlusCircle size={20} />
                  </button>
                </div>
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={draft.flexible}
                  onChange={(event) => setDraft((prev) => ({ ...prev, flexible: event.target.checked }))}
                />
                <span>Flexible split duration</span>
              </label>

              <div className="modal-grid">
                <label className="modal-card">
                  <span>Min duration</span>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={draft.minDuration}
                    onChange={(event) => setDraft((prev) => ({ ...prev, minDuration: clampDuration(Number(event.target.value)) }))}
                    disabled={!draft.flexible}
                  />
                </label>
                <label className="modal-card">
                  <span>Max duration</span>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={draft.maxDuration}
                    onChange={(event) => setDraft((prev) => ({ ...prev, maxDuration: clampDuration(Number(event.target.value)) }))}
                    disabled={!draft.flexible}
                  />
                </label>
              </div>

              <div className="modal-card hours-card">
                <div className="hours-card__label">
                  <span>Hours</span>
                  <small>{presetSummary(selectedPreset)}</small>
                </div>
                <div className="hours-card__actions">
                  <select
                    value={draft.hourPresetId}
                    onChange={(event) => setDraft((prev) => ({ ...prev, hourPresetId: event.target.value }))}
                  >
                    {hourPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="ghost-btn" onClick={() => setShowHoursSettings(true)}>
                    <Settings2 size={16} />
                    Edit
                  </button>
                </div>
              </div>

              <div className="modal-grid">
                <label className="modal-card">
                  <span>Schedule after</span>
                  <input
                    type="date"
                    value={draft.scheduleAfter}
                    onChange={(event) => setDraft((prev) => ({ ...prev, scheduleAfter: event.target.value }))}
                  />
                </label>
                <label className="modal-card">
                  <span>Due date</span>
                  <input
                    type="date"
                    value={draft.deadline}
                    onChange={(event) => setDraft((prev) => ({ ...prev, deadline: event.target.value }))}
                  />
                </label>
              </div>

              <div className="modal-grid">
                <label className="modal-card">
                  <span>Type</span>
                  <select
                    value={draft.type}
                    onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as TaskType }))}
                  >
                    <option value="task">Task</option>
                    <option value="focus">Focus</option>
                    <option value="buffer">Buffer</option>
                  </select>
                </label>
                <div className="modal-card helper-card">
                  <span>Will schedule inside</span>
                  <strong>{selectedPreset.name}</strong>
                  <small>{presetSummary(selectedPreset)}</small>
                </div>
              </div>

              <label className="modal-card notes-card">
                <span>Notes</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Add notes..."
                  rows={4}
                />
              </label>

              <div className="modal-actions">
                {editingTaskId ? (
                  <button type="button" className="ghost-btn danger-btn" onClick={() => void deleteTask()}>
                    Delete
                  </button>
                ) : null}
                <button type="button" className="ghost-btn" onClick={closeTaskModal}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  {editingTaskId ? 'Save changes' : 'Create'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showHoursSettings ? (
        <div className="modal-backdrop" onClick={() => setShowHoursSettings(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal__header">
              <div>
                <strong>Hours settings</strong>
                <p>Edit working, personal, or custom scheduling windows.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowHoursSettings(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="preset-list">
              {hourPresets.map((preset) => (
                <div key={preset.id} className="preset-card">
                  <div className="preset-card__header">
                    <input
                      value={preset.name}
                      onChange={(event) => updatePreset(preset.id, { name: event.target.value })}
                    />
                    <div className="preset-card__meta">
                      {preset.kind === 'custom' ? (
                        <button type="button" className="ghost-btn" onClick={() => deletePreset(preset.id)}>
                          Remove
                        </button>
                      ) : (
                        <span className="preset-kind">{preset.kind}</span>
                      )}
                      <button type="button" className="ghost-btn" onClick={() => addPresetRange(preset.id)}>
                        <Plus size={16} />
                        Add range
                      </button>
                    </div>
                  </div>
                  <p className="preset-summary">{presetSummary(preset)}</p>
                  <div className="preset-ranges">
                    {preset.ranges.map((range, index) => (
                      <div key={`${preset.id}-${index}`} className="preset-range-row">
                        <span>Range {index + 1}</span>
                        <input
                          type="time"
                          value={minutesToTimeInput(range.start_minutes)}
                          onChange={(event) => updatePresetRange(preset.id, index, { start_minutes: timeInputToMinutes(event.target.value) })}
                        />
                        <input
                          type="time"
                          value={minutesToTimeInput(range.end_minutes)}
                          onChange={(event) => updatePresetRange(preset.id, index, { end_minutes: timeInputToMinutes(event.target.value) })}
                        />
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => deletePresetRange(preset.id, index)}
                          disabled={preset.ranges.length === 1}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="settings-modal__actions">
              <button type="button" className="ghost-btn" onClick={addCustomPreset}>
                <Plus size={16} />
                Add custom hours
              </button>
              <button type="button" className="primary-btn" onClick={() => setShowHoursSettings(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
