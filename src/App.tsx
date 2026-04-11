import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Link2,
  ListTodo,
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
  Zap,
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
  findPlacement,
  formatDate,
  formatDisplayRange,
  formatDisplayTime,
  formatTime,
  fromDateKey,
  isSchedulableTask,
  isFlexibleTask,
  sortTasksChronologically,
  startOfWeek,
  toDateKey,
} from './lib/scheduler';
import type { BufferSettings, ScheduleBlock, ScheduleWarning, TaskItem, TaskPriority, TaskType, TimeRange, WorkflowAllocationMode, WorkflowConfig, WorkflowStage } from './types';

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
  scheduleAfterMode: 'now' | 'custom';
  scheduleAfter: string;
  deadline: string;
  description: string;
  workflowEnabled: boolean;
  workflowAllocationMode: WorkflowAllocationMode;
  workflowStages: WorkflowStage[];
}

interface EmojiClickDetail {
  unicode: string;
}

interface DropPreview {
  date: string;
  startMinutes: number;
  valid: boolean;
  snapped: boolean; // true when scheduler moved it from raw hover position
  duration: number;
  dayIndex: number;
}

const HOURS_STORAGE_KEY = 'goodcalendar-hour-presets';
const BUFFER_SETTINGS_STORAGE_KEY = 'goodcalendar-buffer-settings';

// weight = relative share of total time; minutes = auto-calculated, user-editable
const DEFAULT_WORKFLOW_STAGES: WorkflowStage[] = [
  { id: 'req-gathering',      name: 'Requirement Gathering (with client)', enabled: true, weight: 7,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'prd-creation',       name: 'PRD Creation',                        enabled: true, weight: 2,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'po-approval-prd',    name: 'PO Approval (PRD)',                   enabled: true, weight: 1,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'design',             name: 'Design',                              enabled: true, weight: 3,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'po-approval-design', name: 'PO Approval (Design)',                enabled: true, weight: 1,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'development',        name: 'Development (Frontend & Backend)',     enabled: true, weight: 10, minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'dev-checkin',        name: 'Developer Update Check',              enabled: true, weight: 1,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'qa',                 name: 'QA',                                  enabled: true, weight: 2,  minutes: 60, hourPresetId: 'working-hours'  },
  { id: 'deploy-live',        name: 'Deploy to Live',                      enabled: true, weight: 1,  minutes: 60, hourPresetId: 'personal-hours' },
  { id: 'post-release-qa',    name: 'Post-Release QA',                     enabled: true, weight: 2,  minutes: 60, hourPresetId: 'working-hours'  },
];

// startDt / endDt are ISO datetime strings "YYYY-MM-DDTHH:mm"
type StagedWorkflowItem = WorkflowStage & {
  startDt: string;
  endDt: string;
  afterDeadline: boolean;
  unscheduledReason?: string;
};

// ── DateTime helpers ──────────────────────────────────────────────────────────

// Parse "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" → Date (local)
function parseDt(dt: string): Date {
  const normalized = dt.includes(' ') && !dt.includes('T') ? dt.replace(' ', 'T') : dt;
  if (normalized.includes('T')) {
    const [datePart, timePart] = normalized.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = timePart.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi);
  }
  return fromDateKey(normalized);
}

// Format a Date → "YYYY-MM-DDTHH:mm"
function toDtKey(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  const h  = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

// Add minutes to a dt string → dt string
function addMinutesToDt(dt: string, minutes: number): string {
  const date = parseDt(dt);
  date.setMinutes(date.getMinutes() + minutes);
  return toDtKey(date);
}

// Total minutes between two dt strings
function minutesBetweenDt(start: string, end: string): number {
  return Math.round((parseDt(end).getTime() - parseDt(start).getTime()) / 60000);
}

// Format a dt string for display: "Apr 9, 10:30 AM"
function formatDt(dt: string): string {
  if (!dt) return '—';
  const date = parseDt(dt);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Format minutes as human-readable duration: "30m", "2h", "1d 4h", "3d"
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const totalHours = minutes / 60;
  const days = Math.floor(totalHours / 8); // treat 8h = 1 working day for display
  const remHours = Math.round(totalHours % 8 * 2) / 2;
  if (days === 0) return `${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}h`;
  if (remHours === 0) return `${days}d`;
  return `${days}d ${remHours}h`;
}

// Snap minutes to nearest 15
function snapToQuarter(m: number): number {
  return Math.max(15, Math.round(m / 15) * 15);
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

// Normalise stages from storage/Supabase (handles old days/minDays/maxDays shapes)
function normalizeWorkflowStages(raw: Array<Partial<WorkflowStage> & { days?: number; minDays?: number; maxDays?: number }>): WorkflowStage[] {
  return raw.map((s, idx) => {
    const fallbackDays = s.days ?? s.minDays ?? s.maxDays ?? 1;
    const fallbackMinutes = s.minutes ?? (fallbackDays * 8 * 60);
    return {
      id: s.id ?? crypto.randomUUID(),
      name: s.name ?? `Stage ${idx + 1}`,
      enabled: s.enabled ?? true,
      minutes: fallbackMinutes,
      weight: s.weight ?? fallbackDays,
      hourPresetId: s.hourPresetId ?? 'working-hours',
    };
  });
}

// Proportionally distribute totalMinutes across enabled stages by weight, min 15 min each.
function autoDistributeStages(stages: WorkflowStage[], totalMinutes: number): WorkflowStage[] {
  const enabledStages = stages.filter((s) => s.enabled);
  if (enabledStages.length === 0 || totalMinutes <= 0) return stages;
  const totalWeight = enabledStages.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return stages;
  return stages.map((s) => {
    if (!s.enabled) return s;
    const raw = (s.weight / totalWeight) * totalMinutes;
    return { ...s, minutes: snapToQuarter(raw) };
  });
}

function resolveWorkflowStageDurations(
  stages: WorkflowStage[],
  allocationMode: WorkflowAllocationMode,
  scheduleAfterDt: string,
  dueAt?: string,
) {
  if (allocationMode !== 'auto' || !scheduleAfterDt || !dueAt) {
    return stages;
  }

  const totalMinutes = minutesBetweenDt(scheduleAfterDt, dueAt);
  return totalMinutes > 0 ? autoDistributeStages(stages, totalMinutes) : stages;
}
const TIME_GUTTER = 80;
const DURATION_STEP = 15;
const BOARD_TOP_PADDING = 18;
const DEFAULT_BUFFER_SETTINGS: BufferSettings = {
  before_events: 10,
  after_events: 10,
  between_task_habits: 15,
  travel_time: 0,
};
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
    earliest_start_at: dateKeyToDatetime(toDateKey(new Date()), 9, 0),
    schedule_after: toDateKey(new Date()),
    due_at: dateKeyToDatetime(addDays(toDateKey(new Date()), 1), 18, 0),
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
    earliest_start_at: dateKeyToDatetime(toDateKey(new Date()), 9, 0),
    schedule_after: toDateKey(new Date()),
    due_at: dateKeyToDatetime(toDateKey(new Date()), 18, 0),
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
    earliest_start_at: dateKeyToDatetime(addDays(toDateKey(new Date()), 1), 9, 0),
    schedule_after: addDays(toDateKey(new Date()), 1),
    due_at: dateKeyToDatetime(addDays(toDateKey(new Date()), 2), 18, 0),
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

function normalizeDatetimeValue(value: string | null | undefined, fallbackHours = 9, fallbackMinutes = 0) {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  const dateTimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]}T${dateTimeMatch[2]}:${dateTimeMatch[3]}`;
  }

  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateMatch) {
    return dateKeyToDatetime(dateMatch[1], fallbackHours, fallbackMinutes);
  }

  return '';
}

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
  const earliestStartAt = normalizeDatetimeValue(task.earliest_start_at ?? task.schedule_after, 9, 0);
  const dueAt = normalizeDatetimeValue(task.due_at ?? task.deadline, 18, 0);

  return {
    ...task,
    description: task.description ?? '',
    priority: task.priority ?? 'high',
    earliest_start_at: earliestStartAt || undefined,
    hours_ranges: ranges,
    hours_start: task.hours_start ?? bounds.start_minutes,
    hours_end: task.hours_end ?? bounds.end_minutes,
    schedule_after: earliestStartAt ? datetimeToDateKey(earliestStartAt) : (task.schedule_after ?? task.scheduled_date),
    due_at: dueAt || undefined,
    deadline: dueAt ? datetimeToDateKey(dueAt) : task.deadline,
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

function clampBufferDuration(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value / 5) * 5);
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

// "YYYY-MM-DD" → "YYYY-MM-DDTHH:mm" with given time (HH, mm)
function dateKeyToDatetime(dateKey: string, hours = 9, mins = 0): string {
  const h = String(hours).padStart(2, '0');
  const m = String(mins).padStart(2, '0');
  return `${dateKey}T${h}:${m}`;
}

// "YYYY-MM-DDTHH:mm" → "YYYY-MM-DD"
function datetimeToDateKey(dt: string): string {
  return dt.includes('T') ? dt.split('T')[0] : dt;
}

// "YYYY-MM-DDTHH:mm" → minutes since midnight
function datetimeToStartMinutes(dt: string): number {
  if (dt.includes('T')) {
    const [, timePart] = dt.split('T');
    const [h, m] = timePart.split(':').map(Number);
    return h * 60 + m;
  }
  return 9 * 60;
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
    scheduleAfterMode: 'now',
    scheduleAfter: dateKeyToDatetime(selectedDate, 9, 0),
    deadline: '',
    description: '',
    workflowEnabled: false,
    workflowAllocationMode: 'auto',
    workflowStages: DEFAULT_WORKFLOW_STAGES.map((s) => ({ ...s })),
  };
}

function buildDraftFromTask(task: TaskItem, hourPresetId: string): TaskDraft {
  const wfConfig = task.workflow_config;
  const scheduleAfterDt = normalizeDatetimeValue(task.earliest_start_at ?? task.schedule_after ?? task.scheduled_date, 9, 0);
  const deadlineDt = normalizeDatetimeValue(task.due_at ?? task.deadline, 18, 0);
  return {
    title: task.title,
    type: task.type,
    priority: task.priority,
    duration: task.duration,
    flexible: Boolean(task.min_duration || task.max_duration),
    minDuration: task.min_duration ?? Math.min(task.duration, 30),
    maxDuration: task.max_duration ?? Math.max(task.duration, 120),
    hourPresetId,
    scheduleAfterMode: 'custom',
    scheduleAfter: scheduleAfterDt,
    deadline: deadlineDt,
    description: task.description ?? '',
    workflowEnabled: Boolean(wfConfig),
    workflowAllocationMode: wfConfig?.allocation_mode ?? 'auto',
    workflowStages: wfConfig?.stages
      ? normalizeWorkflowStages(wfConfig.stages)
      : DEFAULT_WORKFLOW_STAGES.map((s) => ({ ...s })),
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
  const [bufferSettings, setBufferSettings] = useState<BufferSettings>(DEFAULT_BUFFER_SETTINGS);
  const [tasks, setTasks] = useState<TaskItem[]>(hasSupabaseConfig ? [] : starterTasks);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(
    hasSupabaseConfig ? 'Connecting to Supabase schedule…' : 'Local mode. Add Vercel env vars to sync across devices.',
  );
  const [statusMessage, setStatusMessage] = useState('Drag blocks across the planner to reschedule them.');
  const [draggingPriorityTaskId, setDraggingPriorityTaskId] = useState<string | null>(null);
  const [hoveredPriorityBucket, setHoveredPriorityBucket] = useState<PriorityBucket | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showHoursSettings, setShowHoursSettings] = useState(false);
  const [showBufferSettings, setShowBufferSettings] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [collapsedCompactSections, setCollapsedCompactSections] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<TaskDraft>(buildDraft(todayKey, DEFAULT_HOUR_PRESETS[0].id));
  const emojiPickerHostRef = useRef<HTMLDivElement | null>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const emojiPopoverRef = useRef<HTMLDivElement | null>(null);
  const boardBodyRef = useRef<HTMLDivElement | null>(null);
  const drawStateRef = useRef<{
    startMinutes: number;
    date: string;
    dayIndex: number;
  } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{
    startMinutes: number;
    endMinutes: number;
    dayIndex: number;
  } | null>(null);
  const dragStateRef = useRef<{
    taskId: string;
    task: TaskItem;
    clone: HTMLElement | null;
    sourceEl: HTMLElement;
    startX: number; startY: number;
    offsetX: number; offsetY: number;
    isDragging: boolean;
  } | null>(null);
  const dropPreviewRef = useRef<DropPreview | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  // Current time in minutes since midnight, updated every 30s for the now-line
  const getNowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(getNowMinutes()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Scroll the board to the now-line when entering planner, clicking Today,
  // or navigating to a week that contains today.
  const scrollToNow = () => {
    const el = boardBodyRef.current;
    if (!el) return;
    const nowTop = BOARD_TOP_PADDING + getNowMinutes() * PIXELS_PER_MINUTE;
    const offset = Math.max(0, nowTop - el.clientHeight / 3);
    el.scrollTo({ top: offset, behavior: 'smooth' });
  };

  useEffect(() => {
    if (view !== 'planner') return;
    scrollToNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view !== 'planner') return;
    if (selectedDate !== todayKey) return;
    scrollToNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (view !== 'planner') return;
    // Only scroll when the visible week contains today
    if (!weekDates.includes(todayKey)) return;
    scrollToNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

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

    const stored = window.localStorage.getItem(BUFFER_SETTINGS_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<BufferSettings>;
      setBufferSettings({
        before_events: parsed.before_events ?? DEFAULT_BUFFER_SETTINGS.before_events,
        after_events: parsed.after_events ?? DEFAULT_BUFFER_SETTINGS.after_events,
        between_task_habits: parsed.between_task_habits ?? DEFAULT_BUFFER_SETTINGS.between_task_habits,
        travel_time: parsed.travel_time ?? DEFAULT_BUFFER_SETTINGS.travel_time,
      });
    } catch {
      window.localStorage.removeItem(BUFFER_SETTINGS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(HOURS_STORAGE_KEY, JSON.stringify(hourPresets));
  }, [hourPresets]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(BUFFER_SETTINGS_STORAGE_KEY, JSON.stringify(bufferSettings));
  }, [bufferSettings]);

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

  const schedulableTasks = useMemo(
    () => tasks.filter((task) => isSchedulableTask(task)),
    [tasks],
  );

  const activeSchedulableTasks = useMemo(
    () => schedulableTasks.filter((task) => !task.done),
    [schedulableTasks],
  );

  const planningStart = useMemo(() => {
    const seeds = [todayKey, weekDates[0], ...schedulableTasks.map((task) => task.schedule_after ?? task.scheduled_date)];
    return seeds.reduce((earliest, current) => (current < earliest ? current : earliest));
  }, [schedulableTasks, todayKey, weekDates]);

  const planningEnd = useMemo(() => {
    const seeds = [weekDates[6], ...schedulableTasks.map((task) => task.deadline ?? task.scheduled_date)];
    const latest = seeds.reduce((currentLatest, current) => (current > currentLatest ? current : currentLatest));
    return addDays(latest, 14);
  }, [schedulableTasks, weekDates]);

  // Do NOT pass nowMinutes here — existing tasks render at their stored
  // start_minutes. The now-floor only applies when placing a new task.
  const optimizedBlocks = useMemo<ScheduleBlock[]>(
    () => buildScheduleBlocks(schedulableTasks, planningStart, planningEnd, bufferSettings),
    [schedulableTasks, planningStart, planningEnd, bufferSettings],
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
    () => buildWarnings(schedulableTasks, todayKey, selectedDate, bufferSettings),
    [schedulableTasks, todayKey, selectedDate, bufferSettings],
  );

  const filteredOpenTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeSchedulableTasks
      .filter((task) => (normalizedQuery ? task.title.toLowerCase().includes(normalizedQuery) : true));
  }, [activeSchedulableTasks, query]);

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
    if (schedulableTasks.length === 0) return 0;
    const totalMinutes = schedulableTasks.reduce((sum, task) => sum + task.duration, 0);
    if (totalMinutes > 0) {
      const completedMinutes = schedulableTasks
        .filter((task) => task.done)
        .reduce((sum, task) => sum + task.duration, 0);
      return Math.round((completedMinutes / totalMinutes) * 100);
    }
    return Math.round((schedulableTasks.filter((task) => task.done).length / schedulableTasks.length) * 100);
  }, [schedulableTasks]);

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

  const roundNowToFiveMinutesDt = () => {
    const now = new Date();
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5, 0, 0);
    return toDtKey(now);
  };

  const blockEndDt = (block: ScheduleBlock) =>
    addMinutesToDt(
      dateKeyToDatetime(block.scheduled_date, Math.floor(block.start_minutes / 60), block.start_minutes % 60),
      block.duration,
    );

  const resolveScheduledItemPlacement = (baseItem: TaskItem, scheduledTasks: TaskItem[]) => {
    const relevantTasks = scheduledTasks.filter((task) => isSchedulableTask(task));
    const planningStartSeeds = [todayKey, weekDates[0], ...relevantTasks.map((task) => task.schedule_after ?? task.scheduled_date)];
    const resolvedPlanningStart = planningStartSeeds.reduce((earliest, current) => (current < earliest ? current : earliest));
    const planningEndSeeds = [weekDates[6], ...relevantTasks.map((task) => task.deadline ?? task.scheduled_date)];
    const resolvedPlanningEnd = addDays(
      planningEndSeeds.reduce((latest, current) => (current > latest ? current : latest)),
      14,
    );
    const previewBlocks = buildScheduleBlocks(
      relevantTasks,
      resolvedPlanningStart,
      resolvedPlanningEnd,
      bufferSettings,
      todayKey,
      nowMinutes,
    ).filter((block) => block.task_id === baseItem.id);

    if (previewBlocks.length === 0) {
      return { error: 'No conflict-free schedule was found for the selected hours and deadline window.' as const };
    }

    const firstBlock = previewBlocks[0];
    const lastBlock = previewBlocks[previewBlocks.length - 1];
    const startDt = dateKeyToDatetime(
      firstBlock.scheduled_date,
      Math.floor(firstBlock.start_minutes / 60),
      firstBlock.start_minutes % 60,
    );
    const endDt = blockEndDt(lastBlock);
    const afterDeadline = Boolean(baseItem.due_at && parseDt(endDt).getTime() > parseDt(baseItem.due_at).getTime());

    return {
      item: {
        ...baseItem,
        scheduled_date: firstBlock.scheduled_date,
        start_minutes: firstBlock.start_minutes,
      },
      placement: {
        scheduled_date: firstBlock.scheduled_date,
        start_minutes: firstBlock.start_minutes,
        afterDeadline,
      },
      startDt,
      endDt,
    };
  };

  const buildDraftTaskItem = (currentDraft: TaskDraft, existingTask: TaskItem | null) => {
    const duration = clampDuration(currentDraft.duration);
    const normalizedMinDuration = currentDraft.flexible
      ? Math.min(clampDuration(Math.min(currentDraft.minDuration, currentDraft.maxDuration)), duration)
      : undefined;
    const normalizedMaxDuration = currentDraft.flexible
      ? Math.min(Math.max(clampDuration(Math.max(currentDraft.minDuration, currentDraft.maxDuration)), normalizedMinDuration ?? DURATION_STEP), duration)
      : undefined;
    const resolvedEarliestStartAt = currentDraft.scheduleAfterMode === 'now'
      ? roundNowToFiveMinutesDt()
      : (normalizeDatetimeValue(currentDraft.scheduleAfter, 9, 0) || dateKeyToDatetime(selectedDate, 9, 0));
    const dueAt = normalizeDatetimeValue(currentDraft.deadline, 18, 0) || undefined;
    const scheduleAfter = datetimeToDateKey(resolvedEarliestStartAt);
    const scheduleAfterMinutes = datetimeToStartMinutes(resolvedEarliestStartAt);
    const preset =
      hourPresets.find((entry) => entry.id === currentDraft.hourPresetId) ??
      hourPresets[0] ??
      DEFAULT_HOUR_PRESETS[0];
    const presetRanges = normalizeRanges(preset.ranges);
    const presetBounds = rangeBounds(presetRanges);

    if (presetRanges.length === 0) {
      return { error: 'Selected hours need at least one valid time range.' as const };
    }

    return {
      item: {
        id: existingTask?.id ?? editingTaskId ?? crypto.randomUUID(),
        title: currentDraft.title.trim(),
        description: currentDraft.description.trim(),
        type: currentDraft.type,
        priority: currentDraft.priority,
        duration,
        min_duration: normalizedMinDuration,
        max_duration: normalizedMaxDuration,
        hour_preset: preset.name,
        hours_start: presetBounds.start_minutes,
        hours_end: presetBounds.end_minutes,
        hours_ranges: presetRanges,
        earliest_start_at: resolvedEarliestStartAt,
        schedule_after: scheduleAfter,
        due_at: dueAt,
        deadline: dueAt ? datetimeToDateKey(dueAt) : undefined,
        scheduled_date: existingTask?.scheduled_date ?? scheduleAfter,
        start_minutes: existingTask?.start_minutes ?? Math.max(scheduleAfterMinutes, presetBounds.start_minutes),
        done: existingTask?.done ?? false,
        is_pinned: false, // modal save re-enables auto-scheduling
      } satisfies TaskItem,
      resolvedEarliestStartAt,
      dueAt,
    };
  };

  const resolveDraftPlacement = (currentDraft: TaskDraft, existingTask: TaskItem | null) => {
    const base = buildDraftTaskItem(currentDraft, existingTask);
    if ('error' in base) {
      return base;
    }

    const previewTasks = existingTask
      ? tasks.map((task) => (task.id === existingTask.id ? base.item : task))
      : [...tasks, base.item];
    return resolveScheduledItemPlacement(base.item, previewTasks);
  };

  const resolveWorkflowStages = (currentDraft: TaskDraft, parentId: string, existingTask: TaskItem | null) => {
    const workflowStartAt = currentDraft.scheduleAfterMode === 'now'
      ? roundNowToFiveMinutesDt()
      : (normalizeDatetimeValue(currentDraft.scheduleAfter, 9, 0) || dateKeyToDatetime(selectedDate, 9, 0));
    const workflowDueAt = normalizeDatetimeValue(currentDraft.deadline, 18, 0) || undefined;
    const stagesForScheduling = resolveWorkflowStageDurations(
      currentDraft.workflowStages,
      currentDraft.workflowAllocationMode,
      workflowStartAt,
      workflowDueAt,
    );
    const existingChildren = existingTask ? tasks.filter((task) => task.workflow_parent_id === existingTask.id) : [];
    let scheduledTasks = existingTask
      ? tasks.filter((task) => task.id !== existingTask.id && task.workflow_parent_id !== existingTask.id)
      : [...tasks];
    let nextEarliestStartAt = workflowStartAt;
    let blocked = false;

    const stageTasks: TaskItem[] = [];
    const stagedItems: StagedWorkflowItem[] = stagesForScheduling.map((stage) => {
      if (!stage.enabled) {
        return { ...stage, startDt: '', endDt: '', afterDeadline: false };
      }

      if (blocked) {
        return {
          ...stage,
          startDt: '',
          endDt: '',
          afterDeadline: false,
          unscheduledReason: 'Blocked by an earlier stage that could not be placed.',
        };
      }

      const existingChild = existingChildren.find((child) => child.workflow_stage_id === stage.id);
      const stagePreset =
        hourPresets.find((preset) => preset.id === stage.hourPresetId) ??
        hourPresets.find((preset) => preset.kind === 'working') ??
        selectedPreset;
      const stageRanges = normalizeRanges(stagePreset.ranges);
      const stageBounds = rangeBounds(stageRanges);
      const stageDuration = Math.max(stage.minutes, DURATION_STEP);
      const stageMinDuration = Math.max(Math.round(stageDuration / 4), DURATION_STEP);
      const stageDateKey = datetimeToDateKey(nextEarliestStartAt);
      const stageStartMinutes = datetimeToStartMinutes(nextEarliestStartAt);
      const baseStageItem: TaskItem = {
        id: existingChild?.id ?? crypto.randomUUID(),
        title: `${currentDraft.title.trim()} — ${stage.name}`,
        description: `Workflow stage of "${currentDraft.title.trim()}"`,
        type: 'task',
        priority: currentDraft.priority,
        duration: stageDuration,
        min_duration: Math.min(stageMinDuration, stageDuration),
        max_duration: stageDuration,
        hour_preset: stagePreset.name,
        hours_start: stageBounds.start_minutes,
        hours_end: stageBounds.end_minutes,
        hours_ranges: stageRanges,
        earliest_start_at: nextEarliestStartAt,
        schedule_after: stageDateKey,
        due_at: workflowDueAt,
        deadline: workflowDueAt ? datetimeToDateKey(workflowDueAt) : undefined,
        scheduled_date: existingChild?.scheduled_date ?? stageDateKey,
        start_minutes: existingChild?.start_minutes ?? Math.max(stageStartMinutes, stageBounds.start_minutes),
        done: existingChild?.done ?? false,
        workflow_parent_id: parentId,
        workflow_stage_id: stage.id,
      };
      const resolvedStage = resolveScheduledItemPlacement(baseStageItem, [...scheduledTasks, baseStageItem]);
      if ('error' in resolvedStage) {
        blocked = true;
        return {
          ...stage,
          startDt: '',
          endDt: '',
          afterDeadline: false,
          unscheduledReason: resolvedStage.error,
        };
      }

      scheduledTasks = [...scheduledTasks, resolvedStage.item];
      stageTasks.push(resolvedStage.item);
      nextEarliestStartAt = resolvedStage.endDt;

      return {
        ...stage,
        startDt: resolvedStage.startDt,
        endDt: resolvedStage.endDt,
        afterDeadline: resolvedStage.placement.afterDeadline,
      };
    });

    return {
      workflowStartAt,
      workflowDueAt,
      configuredStages: stagesForScheduling,
      stagedItems,
      stageTasks,
    };
  };

  // Real-time scheduling preview hint shown in the create/edit modal
  const draftSchedulingHint = useMemo(() => {
    if (!showTaskModal || draft.workflowEnabled) return null;
    const existingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
    const resolved = resolveDraftPlacement(draft, existingTask);
    if ('error' in resolved) return { text: (resolved.error ?? '') === 'Selected hours need at least one valid time range.' ? (resolved.error ?? '') : 'No open slot found — try adjusting hours or deadline.', warn: true };
    if (!('placement' in resolved)) return null;
    const placement = (resolved as { placement: { scheduled_date: string; start_minutes: number; afterDeadline: boolean } }).placement;
    const tomorrowKey = addDays(todayKey, 1);
    const dateLabel = placement.scheduled_date === todayKey
      ? 'today'
      : placement.scheduled_date === tomorrowKey
        ? 'tomorrow'
        : formatDate(placement.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' });
    const timeLabel = formatDisplayTime(placement.start_minutes);
    if (placement.afterDeadline) return { text: `Best slot ${dateLabel} at ${timeLabel} — past due date`, warn: true };
    return { text: `Best time: ${dateLabel} at ${timeLabel}`, warn: false };
  }, [showTaskModal, draft, tasks, bufferSettings, editingTaskId, selectedDate, todayKey, hourPresets, planningStart, planningEnd, nowMinutes]);

  const calculatedStages = (() => {
    if (!draft.workflowEnabled) return [] as StagedWorkflowItem[];
    const existingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
    return resolveWorkflowStages(draft, editingTaskId ?? 'workflow-preview', existingTask).stagedItems;
  })();

  const setWorkflowAllocationMode = (mode: WorkflowAllocationMode) => {
    setDraft((prev) => {
      if (prev.workflowAllocationMode === mode) {
        return prev;
      }

      if (mode === 'manual') {
        const workflowStartAt = prev.scheduleAfterMode === 'now'
          ? roundNowToFiveMinutesDt()
          : (normalizeDatetimeValue(prev.scheduleAfter, 9, 0) || dateKeyToDatetime(selectedDate, 9, 0));
        const workflowDueAt = normalizeDatetimeValue(prev.deadline, 18, 0) || undefined;
        const distributedStages = resolveWorkflowStageDurations(
          prev.workflowStages,
          prev.workflowAllocationMode,
          workflowStartAt,
          workflowDueAt,
        );
        return {
          ...prev,
          workflowAllocationMode: mode,
          workflowStages: distributedStages.map((stage) => ({ ...stage })),
        };
      }

      return {
        ...prev,
        workflowAllocationMode: mode,
      };
    });
  };

  const focusDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setWeekStart(startOfWeek(fromDateKey(dateKey)));
  };

  const openTaskModal = () => {
    setEditingTaskId(null);
    setDraft(buildDraft(selectedDate, hourPresets[0]?.id ?? DEFAULT_HOUR_PRESETS[0].id));
    setShowMoreOptions(false);
    setShowTaskModal(true);
  };

  const openTaskModalWithTime = (date: string, startMinutes: number, durationMinutes: number) => {
    setEditingTaskId(null);
    const presetId = hourPresets[0]?.id ?? DEFAULT_HOUR_PRESETS[0].id;
    const base = buildDraft(date, presetId);
    setDraft({
      ...base,
      scheduleAfterMode: 'custom',
      scheduleAfter: dateKeyToDatetime(date, Math.floor(startMinutes / 60), startMinutes % 60),
      deadline: '',
      duration: Math.max(durationMinutes, DURATION_STEP),
    });
    setShowMoreOptions(false);
    setShowTaskModal(true);
  };

  // Pointer handlers for drag-to-create on the board background
  const boardMinutesAt = (clientY: number): number => {
    const board = boardBodyRef.current;
    if (!board) return 0;
    const bounds = board.getBoundingClientRect();
    const raw = (clientY - bounds.top + board.scrollTop - BOARD_TOP_PADDING) / PIXELS_PER_MINUTE + boardWindow.start;
    return Math.round(raw / DURATION_STEP) * DURATION_STEP;
  };

  const boardDayAt = (clientX: number): { dayIndex: number; date: string } | null => {
    const board = boardBodyRef.current;
    if (!board) return null;
    const bounds = board.getBoundingClientRect();
    const relX = clientX - bounds.left - TIME_GUTTER;
    if (relX < 0) return null;
    const dayWidth = Math.max((bounds.width - TIME_GUTTER) / 7, 1);
    const dayIndex = Math.max(0, Math.min(6, Math.floor(relX / dayWidth)));
    return { dayIndex, date: weekDates[dayIndex] };
  };

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only trigger on the board background — not on task cards
    if ((event.target as HTMLElement).closest('.week-task, .week-task-done-strip')) return;
    if (event.button !== 0) return;

    const day = boardDayAt(event.clientX);
    if (!day) return;
    const startMinutes = boardMinutesAt(event.clientY);

    const anchor = startMinutes;
    drawStateRef.current = { startMinutes: anchor, date: day.date, dayIndex: day.dayIndex };
    setDrawPreview({ startMinutes: anchor, endMinutes: anchor + DURATION_STEP, dayIndex: day.dayIndex });

    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);

    // Auto-scroll state
    let scrollRafId = 0;
    const SCROLL_ZONE = 60; // px from edge triggers scroll
    const MAX_SCROLL_SPEED = 12; // px per frame

    const stopAutoScroll = () => {
      if (scrollRafId) { cancelAnimationFrame(scrollRafId); scrollRafId = 0; }
    };

    const startAutoScroll = (speed: number) => {
      stopAutoScroll();
      const step = () => {
        const board = boardBodyRef.current;
        if (!board || speed === 0) return;
        board.scrollTop += speed;
        scrollRafId = requestAnimationFrame(step);
      };
      scrollRafId = requestAnimationFrame(step);
    };

    // Closure ref so onUpFinal can read the final snapped range
    const finalPreviewRef = { current: { startMinutes: anchor, endMinutes: anchor + DURATION_STEP } };

    const computeRange = (cursorMinutes: number): { lo: number; hi: number } => {
      if (cursorMinutes >= anchor) {
        return { lo: anchor, hi: Math.max(cursorMinutes, anchor + DURATION_STEP) };
      } else {
        return { lo: Math.min(cursorMinutes, anchor - DURATION_STEP), hi: anchor };
      }
    };

    const onMoveCapture = (e: PointerEvent) => {
      if (!drawStateRef.current) return;
      const board = boardBodyRef.current;

      // Edge auto-scroll
      if (board) {
        const bounds = board.getBoundingClientRect();
        const distTop = e.clientY - bounds.top;
        const distBottom = bounds.bottom - e.clientY;
        if (distTop < SCROLL_ZONE && distTop > 0) {
          const speed = -MAX_SCROLL_SPEED * (1 - distTop / SCROLL_ZONE);
          startAutoScroll(speed);
        } else if (distBottom < SCROLL_ZONE && distBottom > 0) {
          const speed = MAX_SCROLL_SPEED * (1 - distBottom / SCROLL_ZONE);
          startAutoScroll(speed);
        } else {
          stopAutoScroll();
        }
      }

      const cursorMinutes = boardMinutesAt(e.clientY);
      const { lo, hi } = computeRange(cursorMinutes);
      finalPreviewRef.current = { startMinutes: lo, endMinutes: hi };
      setDrawPreview({ startMinutes: lo, endMinutes: hi, dayIndex: drawStateRef.current.dayIndex });
    };

    const onUpFinal = () => {
      stopAutoScroll();
      el.removeEventListener('pointermove', onMoveCapture);
      el.removeEventListener('pointerup', onUpFinal);

      const s = drawStateRef.current;
      drawStateRef.current = null;
      setDrawPreview(null);

      if (!s) return;
      const { startMinutes: lo, endMinutes: hi } = finalPreviewRef.current;
      const duration = Math.max(hi - lo, DURATION_STEP);
      openTaskModalWithTime(s.date, lo, duration);
    };

    el.addEventListener('pointermove', onMoveCapture);
    el.addEventListener('pointerup', onUpFinal);
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
    setShowMoreOptions(true);
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

    const preset = hourPresets.find((entry) => entry.id === draft.hourPresetId) ?? selectedPreset;
    const presetRanges = normalizeRanges(preset.ranges);
    const presetBounds = rangeBounds(presetRanges);

    if (presetRanges.length === 0) {
      setStatusMessage('Selected hours need at least one valid time range.');
      return;
    }

    const existingTask = editingTaskId ? (tasks.find((task) => task.id === editingTaskId) ?? null) : null;

    // ── WORKFLOW PATH ──────────────────────────────────────────────────────────
    if (draft.workflowEnabled) {
      const enabledCount = draft.workflowStages.filter((s) => s.enabled).length;
      if (enabledCount === 0) {
        setStatusMessage('Enable at least one workflow stage.');
        return;
      }
      const parentId = editingTaskId ?? crypto.randomUUID();
      const resolvedWorkflow = resolveWorkflowStages(draft, parentId, existingTask);
      const firstEnabled = resolvedWorkflow.stagedItems.find((stage) => stage.enabled && stage.startDt);
      if (!firstEnabled?.startDt) {
        const firstUnscheduled = resolvedWorkflow.stagedItems.find((stage) => stage.enabled && stage.unscheduledReason);
        setStatusMessage(firstUnscheduled?.unscheduledReason ?? 'Could not calculate workflow stage placements.');
        return;
      }

      const workflowDueAt = resolvedWorkflow.workflowDueAt;
      const wfConfig: WorkflowConfig = {
        stages: resolvedWorkflow.configuredStages,
        allocation_mode: draft.workflowAllocationMode,
      };

      const parentDateKey = datetimeToDateKey(firstEnabled.startDt);
      const parentStartMinutes = datetimeToStartMinutes(firstEnabled.startDt);
      const deadlineDateKey = workflowDueAt ? datetimeToDateKey(workflowDueAt) : undefined;

      const parentItem: TaskItem = {
        id: parentId,
        title: draft.title.trim(),
        description: draft.description.trim(),
        type: 'task',
        priority: draft.priority,
        duration: 30,
        hour_preset: preset.name,
        hours_start: presetBounds.start_minutes,
        hours_end: presetBounds.end_minutes,
        hours_ranges: presetRanges,
        earliest_start_at: resolvedWorkflow.workflowStartAt,
        schedule_after: datetimeToDateKey(resolvedWorkflow.workflowStartAt),
        due_at: workflowDueAt,
        deadline: deadlineDateKey,
        scheduled_date: parentDateKey,
        start_minutes: parentStartMinutes,
        done: existingTask?.done ?? false,
        workflow_config: wfConfig,
      };
      const stageTasks = resolvedWorkflow.stageTasks.map((stageTask) => ({
        ...stageTask,
        workflow_parent_id: parentId,
      }));

      const previousTasks = tasks;
      setTasks((prev) => {
        const filtered = editingTaskId
          ? prev.filter((t) => t.id !== editingTaskId && t.workflow_parent_id !== editingTaskId)
          : prev;
        return sortTasksChronologically([...filtered, parentItem, ...stageTasks]);
      });
      focusDate(parentItem.scheduled_date);
      setView('planner');
      closeTaskModal();
      setStatusMessage(
        `${parentItem.title} ${editingTaskId ? 'updated' : 'created'} with ${stageTasks.length} workflow stages.`,
      );

      if (!supabase) return;

      if (editingTaskId) {
        await supabase.from('schedule_items').delete().eq('workflow_parent_id', editingTaskId);
        const { error: updateError } = await supabase
          .from('schedule_items')
          .update({
            title: parentItem.title,
            description: parentItem.description,
            type: parentItem.type,
            priority: parentItem.priority,
            duration: parentItem.duration,
            hour_preset: parentItem.hour_preset,
            hours_start: parentItem.hours_start,
            hours_end: parentItem.hours_end,
            hours_ranges: parentItem.hours_ranges,
            earliest_start_at: parentItem.earliest_start_at,
            schedule_after: parentItem.schedule_after,
            due_at: parentItem.due_at,
            deadline: parentItem.deadline,
            scheduled_date: parentItem.scheduled_date,
            start_minutes: parentItem.start_minutes,
            workflow_config: parentItem.workflow_config,
          })
          .eq('id', parentId);
        if (updateError) {
          setSyncMessage(`Update failed: ${updateError.message}`);
          setTasks(previousTasks);
          return;
        }
      } else {
        const { error: insertError } = await supabase.from('schedule_items').insert(parentItem);
        if (insertError) {
          setSyncMessage(`Insert failed: ${insertError.message}`);
          setTasks(previousTasks);
          return;
        }
      }

      const { error: stageError } = await supabase.from('schedule_items').insert(stageTasks);
      if (stageError) {
        setSyncMessage(`Stage insert failed: ${stageError.message}`);
        setTasks(previousTasks);
      }
      return;
    }

    // ── NORMAL PATH ───────────────────────────────────────────────────────────
    const resolved = resolveDraftPlacement(draft, existingTask);
    if ('error' in resolved) {
      setStatusMessage(resolved.error ?? 'Scheduling error.');
      return;
    }
    if (!('placement' in resolved)) {
      setStatusMessage('No open slot found for the selected hours and deadline window.');
      return;
    }
    const { item, placement } = resolved as { item: TaskItem; placement: { scheduled_date: string; start_minutes: number; afterDeadline: boolean }; startDt: string; endDt: string };

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
          earliest_start_at: item.earliest_start_at,
          schedule_after: item.schedule_after,
          due_at: item.due_at,
          deadline: item.deadline,
          scheduled_date: item.scheduled_date,
          start_minutes: item.start_minutes,
          is_pinned: false,
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
    const targetId = editingTaskId;
    if (!targetId) {
      return;
    }

    const previousTasks = tasks;
    const target = tasks.find((task) => task.id === targetId);
    if (!target) {
      return;
    }

    // Remove parent + any workflow children from local state
    setTasks((prev) => prev.filter((task) => task.id !== targetId && task.workflow_parent_id !== targetId));
    closeTaskModal();
    setStatusMessage(`${target.title} deleted.`);

    if (!supabase) {
      return;
    }

    // Delete workflow children first if this is a workflow parent
    if (target.workflow_config) {
      await supabase.from('schedule_items').delete().eq('workflow_parent_id', targetId);
    }

    const { error } = await supabase.from('schedule_items').delete().eq('id', targetId);
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

  const handlePriorityCardPointerDown = (task: TaskItem) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;

    const sourceEl = e.currentTarget as HTMLElement;
    const rect = sourceEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    let clone: HTMLElement | null = null;
    let ghost: HTMLElement | null = null;
    let activeZone: Element | null = null;
    let dragging = false;

    const beginDrag = () => {
      dragging = true;

      // Suppress the next click so the edit modal doesn't fire on drop
      const suppressClick = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', suppressClick, { capture: true, once: true });

      clone = sourceEl.cloneNode(true) as HTMLElement;
      clone.style.cssText = `
        position:fixed;pointer-events:none;z-index:9999;
        width:${rect.width}px;left:${rect.left}px;top:${rect.top}px;
        transform:scale(1.04) rotate(-0.6deg);
        box-shadow:0 14px 40px rgba(0,0,0,0.22),0 4px 12px rgba(0,0,0,0.12);
        opacity:0.96;border-radius:10px;will-change:left,top;
        transition:transform 0.1s ease,box-shadow 0.1s ease;
      `;
      document.body.appendChild(clone);
      setDraggingPriorityTaskId(task.id);
    };

    const findZone = (x: number, y: number): Element | null => {
      const zones = Array.from(document.querySelectorAll<HTMLElement>('.priority-dropzone[data-bucket]'));
      for (const z of zones) {
        const r = z.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
      }
      // Magnetic snap: nearest zone within 80px
      let nearest: Element | null = null;
      let minDist = 80;
      for (const z of zones) {
        const r = z.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) { minDist = dist; nearest = z; }
      }
      return nearest;
    };

    const setZone = (zone: Element | null) => {
      if (zone === activeZone) return;
      if (ghost) { ghost.remove(); ghost = null; }
      if (activeZone) activeZone.classList.remove('dnd-active');
      activeZone = zone;
      if (!zone) { setHoveredPriorityBucket(null); return; }
      zone.classList.add('dnd-active');
      setHoveredPriorityBucket(zone.getAttribute('data-bucket') as PriorityBucket);
      ghost = document.createElement('div');
      ghost.className = 'priority-ghost';
      ghost.style.height = `${sourceEl.offsetHeight}px`;
      zone.appendChild(ghost);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) beginDrag();
        return;
      }
      if (!clone) return;
      clone.style.left = `${e.clientX - offsetX}px`;
      clone.style.top = `${e.clientY - offsetY}px`;
      setZone(findZone(e.clientX, e.clientY));
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
      if (ghost) { ghost.remove(); ghost = null; }
      if (activeZone) { activeZone.classList.remove('dnd-active'); activeZone = null; }
      if (clone) {
        clone.style.transition = 'transform 0.15s ease,opacity 0.15s ease';
        clone.style.transform = 'scale(0.92)';
        clone.style.opacity = '0';
        const c = clone; clone = null;
        setTimeout(() => c.remove(), 170);
      }
      setDraggingPriorityTaskId(null);
      setHoveredPriorityBucket(null);
    };

    const onUp = async () => {
      const dropBucket = activeZone?.getAttribute('data-bucket') as PriorityBucket | undefined;
      cleanup();
      if (dragging && dropBucket) await updateTaskPriority(task.id, dropBucket);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey);
  };

  // Pure commit — placement is already resolved by computeDropPreview.
  const moveTask = async (taskId: string, dateKey: string, startMinutes: number, snapped: boolean) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;

    const afterDeadline = Boolean(task.deadline && dateKey > task.deadline);
    const previousTasks = tasks;

    setTasks(sortTasksChronologically(
      tasks.map((entry) =>
        entry.id === taskId
          ? { ...entry, scheduled_date: dateKey, start_minutes: startMinutes, is_pinned: true }
          : entry,
      ),
    ));
    focusDate(dateKey);
    setStatusMessage(
      snapped
        ? `${task.title} snapped to ${formatDisplayTime(startMinutes)} on ${formatDate(dateKey, { weekday: 'short', month: 'short', day: 'numeric' })}${afterDeadline ? ' — past due date.' : '.'}`
        : `${task.title} moved to ${formatDisplayTime(startMinutes)}${afterDeadline ? ' — past due date.' : '.'}`,
    );

    await persistTaskUpdate(taskId, { scheduled_date: dateKey, start_minutes: startMinutes, is_pinned: true }, previousTasks);
  };

  // ── Pointer-based drag for calendar task cards ───────────────────────────────

  const updateDropPreview = (preview: DropPreview | null) => {
    const prev = dropPreviewRef.current;
    if (
      preview?.date !== prev?.date ||
      preview?.startMinutes !== prev?.startMinutes ||
      preview?.valid !== prev?.valid
    ) {
      dropPreviewRef.current = preview;
      setDropPreview(preview);
    }
  };

  const computeDropPreview = (clientX: number, clientY: number, task: TaskItem) => {
    const board = boardBodyRef.current;
    if (!board) { updateDropPreview(null); return; }
    const bounds = board.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      updateDropPreview(null);
      return;
    }
    const relativeX = clientX - bounds.left - TIME_GUTTER;
    const dayWidth = Math.max((bounds.width - TIME_GUTTER) / 7, 1);
    const dayIndex = Math.max(0, Math.min(6, Math.floor(relativeX / dayWidth)));
    const rawMinutes = (clientY - bounds.top + board.scrollTop - BOARD_TOP_PADDING) / PIXELS_PER_MINUTE + boardWindow.start;
    const hoverMinutes = clampStart(rawMinutes, task.duration);
    const hoverDate = weekDates[dayIndex];

    // Use the same placement engine as moveTask / submitTask so preview always
    // matches the final saved position — including earliest_start_at, due_at,
    // working-hour windows, buffer padding, and conflict snapping.
    const placement = findPlacement(
      activeSchedulableTasks,
      {
        type: task.type,
        duration: task.duration,
        due_at: task.due_at,
        deadline: task.deadline,
        earliest_start_at: task.earliest_start_at,
        schedule_after: task.schedule_after,
        hours_ranges: task.hours_ranges,
        hours_start: task.hours_start,
        hours_end: task.hours_end,
      },
      hoverDate,
      hoverMinutes,
      bufferSettings,
      task.id,
    );

    if (!placement) {
      updateDropPreview({ date: hoverDate, startMinutes: hoverMinutes, valid: false, snapped: false, duration: task.duration, dayIndex });
      return;
    }

    const snapped = placement.scheduled_date !== hoverDate || placement.start_minutes !== hoverMinutes;
    updateDropPreview({ date: placement.scheduled_date, startMinutes: placement.start_minutes, valid: true, snapped, duration: task.duration, dayIndex });
  };

  const handleTaskPointerDown = (event: React.PointerEvent<HTMLElement>, taskId: string, draggable: boolean) => {
    if (!draggable || event.button !== 0) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    event.preventDefault(); // suppress native drag & text-select

    const sourceEl = event.currentTarget;
    const rect = sourceEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const state: NonNullable<typeof dragStateRef.current> = {
      taskId, task, clone: null, sourceEl,
      startX, startY, offsetX, offsetY, isDragging: false,
    };
    dragStateRef.current = state;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!state.isDragging) {
        if (Math.sqrt(dx * dx + dy * dy) < 6) return;
        state.isDragging = true;

        const clone = sourceEl.cloneNode(true) as HTMLElement;
        clone.style.cssText = [
          'position:fixed', 'pointer-events:none', 'z-index:9999',
          `width:${rect.width}px`, `height:${rect.height}px`,
          `left:${rect.left}px`, `top:${rect.top}px`,
          'opacity:0.88', 'transform:scale(1.04) rotate(-0.4deg)',
          'box-shadow:0 14px 44px rgba(0,0,0,0.22)',
          'transition:transform 80ms ease,box-shadow 80ms ease',
          'border-radius:10px', 'will-change:left,top',
        ].join(';');
        document.body.appendChild(clone);
        state.clone = clone;
        setDraggingTaskId(taskId);
      }

      if (state.clone) {
        state.clone.style.left = `${e.clientX - offsetX}px`;
        state.clone.style.top = `${e.clientY - offsetY}px`;
      }
      computeDropPreview(e.clientX, e.clientY, task);
    };

    const cleanup = (commit: boolean) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      if (state.clone) {
        state.clone.style.transition = 'opacity 120ms ease,transform 120ms ease';
        state.clone.style.opacity = '0';
        state.clone.style.transform = 'scale(0.95)';
        const c = state.clone; state.clone = null;
        setTimeout(() => c.remove(), 120);
      }

      setDraggingTaskId(null);

      if (commit && state.isDragging && dropPreviewRef.current?.valid) {
        void moveTask(taskId, dropPreviewRef.current.date, dropPreviewRef.current.startMinutes, dropPreviewRef.current.snapped);
      } else if (commit && !state.isDragging) {
        // Tap without drag → open modal
        openEditTaskModalById(taskId);
      }

      dragStateRef.current = null;
      updateDropPreview(null);
    };

    const onUp = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onVisibilityChange = () => { if (document.hidden) cleanup(false); };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('visibilitychange', onVisibilityChange);
  };


  const handleAutoPlaceDay = async () => {
    const previousTasks = tasks;
    const result = autoPlaceDay(tasks, selectedDate, bufferSettings);
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
          className={`priority-card priority-${taskBucket(task, todayKey)} ${compact ? 'compact' : ''}${draggingPriorityTaskId === task.id ? ' is-dragging-source' : ''}`}
          onPointerDown={handlePriorityCardPointerDown(task)}
          onClick={() => openEditTaskModal(task)}
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
                      child === 'Buffers' ? (
                        <button key={child} type="button" className="nav-child nav-child-btn" onClick={() => setShowBufferSettings(true)}>
                          {child}
                        </button>
                      ) : (
                        <div key={child} className="nav-child">
                          {child}
                        </div>
                      )
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

        <div className="workspace-main">
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
                    ref={boardBodyRef}
                    className="week-board__body"
                  >
                    <div
                      className="week-board__inner"
                      style={{ height: `${boardWindow.height + BOARD_TOP_PADDING}px` }}
                      onPointerDown={handleBoardPointerDown}
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

                    {/* Now line — only visible when today is in the current week view */}
                    {weekDates.includes(todayKey) ? (() => {
                      const todayIndex = weekDates.indexOf(todayKey);
                      const top = BOARD_TOP_PADDING + (nowMinutes - boardWindow.start) * PIXELS_PER_MINUTE;
                      return (
                        <div
                          className="now-line"
                          style={{
                            top: `${top}px`,
                            left: `calc(${TIME_GUTTER}px + ${todayIndex} * ((100% - ${TIME_GUTTER}px) / 7))`,
                            width: `calc((100% - ${TIME_GUTTER}px) / 7)`,
                          }}
                        >
                          <span className="now-dot" />
                        </div>
                      );
                    })() : null}

                    {/* Drop indicator ghost */}
                    {dropPreview ? (
                      <div
                        className={`drop-indicator ${dropPreview.valid ? 'valid' : 'invalid'}`}
                        style={{
                          top: `${BOARD_TOP_PADDING + (dropPreview.startMinutes - boardWindow.start) * PIXELS_PER_MINUTE}px`,
                          left: `calc(${TIME_GUTTER}px + ${dropPreview.dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 4px)`,
                          width: `calc((100% - ${TIME_GUTTER}px) / 7 - 8px)`,
                          height: `${Math.max(dropPreview.duration * PIXELS_PER_MINUTE, 38)}px`,
                        }}
                      />
                    ) : null}

                    {/* Drag-to-create preview */}
                    {drawPreview ? (
                      <div
                        className="draw-preview"
                        style={{
                          top: `${BOARD_TOP_PADDING + (drawPreview.startMinutes - boardWindow.start) * PIXELS_PER_MINUTE}px`,
                          left: `calc(${TIME_GUTTER}px + ${drawPreview.dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 4px)`,
                          width: `calc((100% - ${TIME_GUTTER}px) / 7 - 8px)`,
                          height: `${Math.max((drawPreview.endMinutes - drawPreview.startMinutes) * PIXELS_PER_MINUTE, 4)}px`,
                        }}
                      >
                        <span>{formatDisplayTime(drawPreview.startMinutes)} – {formatDisplayTime(drawPreview.endMinutes)}</span>
                      </div>
                    ) : null}

                    {/* Done tasks — thin right-edge strip, below active cards */}
                    {weekTasks.filter((t) => t.done).map((task) => {
                      const dayIndex = weekDates.indexOf(task.scheduled_date);
                      if (dayIndex === -1) return null;
                      return (
                        <div
                          key={task.id}
                          className="week-task-done-strip"
                          title={`${task.title} (done) · ${formatDisplayRange(task.start_minutes, task.duration)}`}
                          style={{
                            top: `${BOARD_TOP_PADDING + (task.start_minutes - boardWindow.start) * PIXELS_PER_MINUTE}px`,
                            left: `calc(${TIME_GUTTER}px + ${dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 6px)`,
                            width: `calc((100% - ${TIME_GUTTER}px) / 7 - 12px)`,
                            height: `${Math.max(task.duration * PIXELS_PER_MINUTE, 4)}px`,
                          }}
                          onClick={() => openEditTaskModalById(task.task_id)}
                        />
                      );
                    })}

                    {/* Active tasks — full-width cards */}
                    {weekTasks.filter((t) => !t.done).map((task) => {
                      const dayIndex = weekDates.indexOf(task.scheduled_date);
                      if (dayIndex === -1) return null;
                      const sourceTask = tasks.find((entry) => entry.id === task.task_id);
                      const draggable = sourceTask ? !isFlexibleTask(sourceTask) : !task.is_split_segment;
                      const isDragging = draggingTaskId === task.task_id;
                      return (
                        <article
                          key={task.id}
                          className={`week-task type-${task.type} priority-${taskBucket(task, todayKey)} ${task.duration <= 30 ? 'compact' : ''} ${isDragging ? 'dragging' : ''}`}
                          style={{
                            top: `${BOARD_TOP_PADDING + (task.start_minutes - boardWindow.start) * PIXELS_PER_MINUTE}px`,
                            left: `calc(${TIME_GUTTER}px + ${dayIndex} * ((100% - ${TIME_GUTTER}px) / 7) + 6px)`,
                            width: `calc((100% - ${TIME_GUTTER}px) / 7 - 12px)`,
                            height: `${Math.max(task.duration * PIXELS_PER_MINUTE, 38)}px`,
                            cursor: draggable ? (isDragging ? 'grabbing' : 'grab') : 'default',
                          }}
                          onPointerDown={(e) => handleTaskPointerDown(e, task.task_id, draggable)}
                        >
                          <strong>{task.title}{task.is_split_segment && task.segment_count > 1 ? ` • ${task.segment_index}/${task.segment_count}` : ''}</strong>
                          <p className="task-time">{formatDisplayRange(task.start_minutes, task.duration)}</p>
                        </article>
                      );
                    })}
                    </div>{/* week-board__inner */}
                  </div>{/* week-board__body */}
                </div>
              </section>
            </div>

            {railOpen ? (
            <aside className="planner-rail">
              <section className="rail-panel">
                <div className="rail-panel__header">
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
                </div>

                <div className="rail-panel__body">
                {railTab === 'priorities' ? (
                  <div className="priority-groups compact">
                    {bucketOrder.map((bucket) => (
                      <section
                        key={bucket}
                        className={`priority-group priority-dropzone${hoveredPriorityBucket === bucket ? ' dnd-active' : ''}`}
                        data-bucket={bucket}
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
                </div>{/* rail-panel__body */}
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
                  className={`priority-column priority-dropzone${hoveredPriorityBucket === bucket ? ' dnd-active' : ''}`}
                  data-bucket={bucket}
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
        </div>{/* workspace-main */}

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
              </div>

              {/* ── Title ── */}
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

              {/* ── Task type ── */}
              <div className="task-type-row">
                {([
                  { value: 'task',   label: 'Task',   icon: <ListTodo size={14} /> },
                  { value: 'focus',  label: 'Focus',  icon: <Zap size={14} /> },
                  { value: 'buffer', label: 'Buffer', icon: <Coffee size={14} /> },
                ] as { value: TaskType; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={`type-pill type-${value}${draft.type === value ? ' active' : ''}`}
                    onClick={() => setDraft((prev) => ({ ...prev, type: value, workflowEnabled: value !== 'task' ? false : prev.workflowEnabled }))}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>

              {/* ── Priority ── */}
              <div className="priority-row">
                {(['critical', 'high', 'medium', 'low'] as TaskPriority[]).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    className={`priority-pill ${draft.priority === priority ? 'active' : ''} ${priority}`}
                    onClick={() => setDraft((prev) => ({ ...prev, priority }))}
                  >
                    {priority[0].toUpperCase() + priority.slice(1)}
                  </button>
                ))}
              </div>

              {/* ── Duration ── */}
              {!draft.workflowEnabled ? (
                <div className="modal-card modal-card--duration">
                  <div>
                    <span>{draft.type === 'focus' ? 'Focus duration' : draft.type === 'buffer' ? 'Block duration' : 'Duration'}</span>
                    <strong>{draft.duration >= 60 ? `${draft.duration / 60} hr${draft.duration >= 120 ? 's' : ''}` : `${draft.duration} min`}</strong>
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
              ) : null}

              {/* ── Schedule after + Due date ── */}
              <div className="modal-timing-row">
                <div className="modal-field">
                  <label className="modal-field__label">Earliest start</label>
                  <div className="schedule-after-row">
                    <div className="seg-control">
                      <button type="button" className={draft.scheduleAfterMode === 'now' ? 'active' : ''} onClick={() => setDraft((prev) => ({ ...prev, scheduleAfterMode: 'now' }))}>Now</button>
                      <button type="button" className={draft.scheduleAfterMode === 'custom' ? 'active' : ''} onClick={() => setDraft((prev) => ({ ...prev, scheduleAfterMode: 'custom' }))}>Custom</button>
                    </div>
                    {draft.scheduleAfterMode === 'custom' ? (
                      <input
                        type="datetime-local"
                        value={draft.scheduleAfter}
                        onChange={(event) => setDraft((prev) => ({ ...prev, scheduleAfter: event.target.value }))}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="modal-field">
                  <label className="modal-field__label">Due date <span className="optional-label">(optional)</span></label>
                  <div className="deadline-row">
                    <input
                      type="datetime-local"
                      value={draft.deadline}
                      onChange={(event) => setDraft((prev) => ({ ...prev, deadline: event.target.value }))}
                    />
                    {draft.deadline ? (
                      <button type="button" className="clear-btn" onClick={() => setDraft((prev) => ({ ...prev, deadline: '' }))} aria-label="Clear due date">
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* ── Scheduling hint ── */}
              {draftSchedulingHint ? (
                <div className={`scheduling-hint${draftSchedulingHint.warn ? ' scheduling-hint--warn' : ''}`}>
                  {draftSchedulingHint.warn ? <Zap size={14} /> : <CalendarRange size={14} />}
                  <span>{draftSchedulingHint.text}</span>
                </div>
              ) : null}

              {/* ── More options accordion ── */}
              <button
                type="button"
                className={`more-options-toggle${showMoreOptions ? ' open' : ''}`}
                onClick={() => setShowMoreOptions((v) => !v)}
              >
                <ChevronDown size={15} />
                {showMoreOptions ? 'Fewer options' : 'More options'}
              </button>

              {showMoreOptions ? (
                <div className="more-options-body">
                  {/* Hours — inline chips */}
                  <div className="modal-card hours-card">
                    <div className="hours-card__label">
                      <span>Hours</span>
                      <small>{presetSummary(selectedPreset)}</small>
                    </div>
                    <div className="hours-preset-chips">
                      {hourPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`hours-preset-chip${draft.hourPresetId === preset.id ? ' active' : ''}`}
                          onClick={() => setDraft((prev) => ({ ...prev, hourPresetId: preset.id }))}
                        >
                          {preset.name}
                        </button>
                      ))}
                      <button type="button" className="hours-preset-chip hours-preset-chip--edit" onClick={() => setShowHoursSettings(true)} aria-label="Edit hours">
                        <Settings2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Flexible split — hidden for buffer type */}
                  {!draft.workflowEnabled && draft.type !== 'buffer' ? (
                    <>
                      <label className="toggle-row">
                        <input type="checkbox" checked={draft.flexible} onChange={(event) => setDraft((prev) => ({ ...prev, flexible: event.target.checked }))} />
                        <span>Flexible split duration</span>
                      </label>
                      {draft.flexible ? (
                        <div className="modal-grid">
                          <label className="modal-card">
                            <span>Min duration (min)</span>
                            <input
                              type="number" min={15} step={15}
                              value={draft.minDuration}
                              onChange={(event) => {
                                const v = clampDuration(Number(event.target.value));
                                setDraft((prev) => ({ ...prev, minDuration: v, maxDuration: Math.max(prev.maxDuration, v) }));
                              }}
                            />
                          </label>
                          <label className="modal-card">
                            <span>Max duration (min)</span>
                            <input
                              type="number" min={15} step={15}
                              value={draft.maxDuration}
                              onChange={(event) => {
                                const v = clampDuration(Number(event.target.value));
                                setDraft((prev) => ({ ...prev, maxDuration: v, minDuration: Math.min(prev.minDuration, v) }));
                              }}
                            />
                          </label>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {/* Workflow — task type only */}
                  {draft.type === 'task' ? (
                  <div className="workflow-section">
                    <label className="workflow-toggle-row">
                      <input type="checkbox" checked={draft.workflowEnabled} onChange={(event) => setDraft((prev) => ({ ...prev, workflowEnabled: event.target.checked }))} />
                      <div className="workflow-toggle-label">
                        <strong>Workflow stages</strong>
                        <span>Schedule a product pipeline forward from earliest start</span>
                      </div>
                    </label>

                    {draft.workflowEnabled ? (
                      draft.scheduleAfterMode === 'custom' && !draft.scheduleAfter ? (
                        <p className="workflow-notice">Set an earliest start date above to calculate timelines.</p>
                      ) : (
                        <div className="workflow-stages">
                          <div className="seg-control">
                            <button
                              type="button"
                              className={draft.workflowAllocationMode === 'auto' ? 'active' : ''}
                              onClick={() => setWorkflowAllocationMode('auto')}
                            >
                              Auto
                            </button>
                            <button
                              type="button"
                              className={draft.workflowAllocationMode === 'manual' ? 'active' : ''}
                              onClick={() => setWorkflowAllocationMode('manual')}
                            >
                              Manual
                            </button>
                          </div>
                          <div className="workflow-stages-header">
                            <span /><span>Stage</span><span>Duration</span><span>Hours</span><span>Timeline</span>
                          </div>
                          {calculatedStages.map((stage, index) => (
                            <div key={stage.id} className={`workflow-stage-row ${stage.enabled ? '' : 'disabled'}`}>
                              <label className="stage-enable">
                                <input type="checkbox" checked={stage.enabled} onChange={(event) => setDraft((prev) => ({ ...prev, workflowStages: prev.workflowStages.map((s) => s.id === stage.id ? { ...s, enabled: event.target.checked } : s) }))} />
                              </label>
                              <span className="stage-name"><span className="stage-num">{index + 1}</span>{stage.name}</span>
                              <div className="stage-days-control">
                                <button
                                  type="button"
                                  className="stage-days-btn"
                                  disabled={!stage.enabled || draft.workflowAllocationMode === 'auto'}
                                  onClick={() => setDraft((prev) => ({ ...prev, workflowStages: prev.workflowStages.map((s) => s.id === stage.id ? { ...s, minutes: Math.max(15, s.minutes - 15) } : s) }))}
                                >
                                  −
                                </button>
                                <span className="stage-days-val">{formatDuration(stage.minutes)}</span>
                                <button
                                  type="button"
                                  className="stage-days-btn"
                                  disabled={!stage.enabled || draft.workflowAllocationMode === 'auto'}
                                  onClick={() => setDraft((prev) => ({ ...prev, workflowStages: prev.workflowStages.map((s) => s.id === stage.id ? { ...s, minutes: s.minutes + 15 } : s) }))}
                                >
                                  +
                                </button>
                              </div>
                              <select className="stage-hours-select" value={stage.hourPresetId} disabled={!stage.enabled} onChange={(event) => setDraft((prev) => ({ ...prev, workflowStages: prev.workflowStages.map((s) => s.id === stage.id ? { ...s, hourPresetId: event.target.value } : s) }))}>
                                {hourPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <span className={`stage-dates ${stage.enabled ? '' : 'muted'}`}>
                                {stage.enabled && stage.startDt
                                  ? `${formatDt(stage.startDt)} → ${formatDt(stage.endDt)}${stage.afterDeadline ? ' ⚠' : ''}`
                                  : stage.unscheduledReason ?? '—'}
                              </span>
                            </div>
                          ))}
                          {(() => {
                            const enabled = calculatedStages.filter((s) => s.enabled);
                            const last = enabled[enabled.length - 1];
                            const total = enabled.reduce((sum, s) => sum + s.minutes, 0);
                            const unresolved = enabled.filter((stage) => !stage.startDt).length;
                            const over = Boolean(draft.deadline && last?.endDt && last.endDt > draft.deadline);
                            return (
                              <div className={`workflow-total ${over ? 'over-deadline' : ''}`}>
                                <span>{enabled.length} stages · {formatDuration(total)} total{draft.deadline && draft.scheduleAfter ? ` of ${formatDuration(minutesBetweenDt(draft.scheduleAfter, draft.deadline))} available` : ''}</span>
                                {unresolved > 0
                                  ? <span>{unresolved} stage{unresolved > 1 ? 's' : ''} could not be placed</span>
                                  : last?.endDt
                                    ? <span>Est. done: {formatDt(last.endDt)}{over ? ' ⚠ past due' : ''}</span>
                                    : null}
                              </div>
                            );
                          })()}
                        </div>
                      )
                    ) : null}
                  </div>
                  ) : null}

                  {/* Notes */}
                  <label className="modal-card notes-card">
                    <span>Notes</span>
                    <textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} placeholder="Add notes..." rows={3} />
                  </label>
                </div>
              ) : null}

              <div className="modal-actions">
                {editingTaskId ? (
                  <button type="button" className="ghost-btn danger-btn" onClick={() => void deleteTask()}>Delete</button>
                ) : null}
                <button type="button" className="ghost-btn" onClick={closeTaskModal}>Cancel</button>
                <button type="submit" className="primary-btn">
                  {editingTaskId ? 'Save changes' : draft.type === 'buffer' ? 'Add Buffer' : draft.workflowEnabled ? 'Create Workflow' : 'Create & Schedule'}
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

      {showBufferSettings ? (
        <div className="modal-backdrop" onClick={() => setShowBufferSettings(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal__header">
              <div>
                <strong>Buffer settings</strong>
                <p>Protect spacing before events, after events, between tasks and habits, and optional travel time.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowBufferSettings(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="buffer-settings-grid">
              <label className="modal-card">
                <span>Before events</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={bufferSettings.before_events}
                  onChange={(event) => setBufferSettings((current) => ({ ...current, before_events: clampBufferDuration(Number(event.target.value)) }))}
                />
                <small>Suggested: 5, 10, 15, 30, 60 mins</small>
              </label>
              <label className="modal-card">
                <span>After events</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={bufferSettings.after_events}
                  onChange={(event) => setBufferSettings((current) => ({ ...current, after_events: clampBufferDuration(Number(event.target.value)) }))}
                />
                <small>Suggested: 5, 10, 15, 30, 60 mins</small>
              </label>
              <label className="modal-card">
                <span>Between tasks and habits</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={bufferSettings.between_task_habits}
                  onChange={(event) => setBufferSettings((current) => ({ ...current, between_task_habits: clampBufferDuration(Number(event.target.value)) }))}
                />
                <small>Protected whenever possible during re-optimization.</small>
              </label>
              <label className="modal-card">
                <span>Travel time</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={bufferSettings.travel_time}
                  onChange={(event) => setBufferSettings((current) => ({ ...current, travel_time: clampBufferDuration(Number(event.target.value)) }))}
                />
                <small>Optional flexible buffer removed first when space is tight.</small>
              </label>
            </div>

            <div className="settings-modal__actions">
              <button type="button" className="ghost-btn" onClick={() => setBufferSettings(DEFAULT_BUFFER_SETTINGS)}>
                Reset defaults
              </button>
              <button type="button" className="primary-btn" onClick={() => setShowBufferSettings(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
