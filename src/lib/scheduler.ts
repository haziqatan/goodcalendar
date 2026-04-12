import type { BufferSettings, ScheduleBlock, ScheduleWarning, TaskItem, TaskPriority, TimeRange } from '../types';

export const MINUTES_IN_DAY = 24 * 60;
export const SNAP_MINUTES = 15;
export const AUTO_START_MINUTES = 8 * 60;
export const AUTO_END_MINUTES = 20 * 60;
export const PIXELS_PER_MINUTE = 1.4;
const AUTO_LOOKAHEAD_DAYS = 7;
const DEFAULT_BUFFER_SETTINGS: BufferSettings = {
  before_events: 10,
  after_events: 10,
  between_task_habits: 15,
  travel_time: 0,
};

const priorityWeight: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(dateKey: string, amount: number) {
  const next = fromDateKey(dateKey);
  next.setDate(next.getDate() + amount);
  return toDateKey(next);
}

export function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = next.getDate() - day + (day === 0 ? -6 : 1);
  next.setDate(diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function formatDate(dateKey: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', options).format(fromDateKey(dateKey));
}

export function formatTime(minutes: number) {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${pad(hours)}:${pad(mins)}`;
}

export function formatRange(startMinutes: number, duration: number) {
  return `${formatTime(startMinutes)} - ${formatTime(startMinutes + duration)}`;
}

export function formatDisplayTime(minutes: number) {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = hours >= 12 ? 'pm' : 'am';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return mins === 0 ? `${displayHour}${period}` : `${displayHour}:${pad(mins)}${period}`;
}

export function formatDisplayRange(startMinutes: number, duration: number) {
  return `${formatDisplayTime(startMinutes)} - ${formatDisplayTime(startMinutes + duration)}`;
}

export function snapMinutes(value: number) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

export function clampStart(startMinutes: number, duration: number) {
  return Math.max(0, Math.min(MINUTES_IN_DAY - duration, snapMinutes(startMinutes)));
}

export function sortTasksChronologically(tasks: TaskItem[]) {
  return [...tasks].sort((left, right) => {
    if (left.scheduled_date === right.scheduled_date) {
      return left.start_minutes - right.start_minutes;
    }
    return left.scheduled_date.localeCompare(right.scheduled_date);
  });
}

function overlaps(aStart: number, aDuration: number, bStart: number, bDuration: number) {
  return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

function dateKeyFromDateTime(value?: string) {
  if (!value) {
    return '';
  }
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? '';
}

function minutesFromDateTime(value?: string, fallback = AUTO_START_MINUTES) {
  if (!value) {
    return fallback;
  }
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  if (!match) {
    return fallback;
  }
  return (Number(match[1]) * 60) + Number(match[2]);
}

function taskEarliestDate(task: Pick<TaskItem, 'earliest_start_at' | 'schedule_after' | 'scheduled_date'>) {
  return dateKeyFromDateTime(task.earliest_start_at) || task.schedule_after || task.scheduled_date;
}

function taskEarliestStart(task: Pick<TaskItem, 'earliest_start_at' | 'hours_ranges' | 'hours_start' | 'hours_end'>) {
  const windows = getTaskWindows(task);
  return dateKeyFromDateTime(task.earliest_start_at)
    ? minutesFromDateTime(task.earliest_start_at, windows[0]?.start_minutes ?? AUTO_START_MINUTES)
    : (windows[0]?.start_minutes ?? AUTO_START_MINUTES);
}

function taskEarliestFloorForDate(
  task: Pick<TaskItem, 'earliest_start_at'>,
  dateKey: string,
) {
  const exactDate = dateKeyFromDateTime(task.earliest_start_at);
  if (!exactDate || exactDate !== dateKey) {
    return 0;
  }
  return minutesFromDateTime(task.earliest_start_at, 0);
}

function taskDueValue(task: Pick<TaskItem, 'due_at' | 'deadline'>) {
  return task.due_at ?? task.deadline;
}

export function isWorkflowMetadataParent(
  task: Pick<TaskItem, 'workflow_config' | 'workflow_parent_id' | 'workflow_stage_id'>,
) {
  return Boolean(task.workflow_config && !task.workflow_parent_id && !task.workflow_stage_id);
}

export function isSchedulableTask(
  task: Pick<TaskItem, 'workflow_config' | 'workflow_parent_id' | 'workflow_stage_id'>,
) {
  return !isWorkflowMetadataParent(task);
}

function isTaskOrHabit(type: TaskItem['type']) {
  return type === 'task' || type === 'buffer';
}

function pairGapMinutes(
  candidateType: TaskItem['type'],
  existingType: TaskItem['type'],
  bufferSettings: BufferSettings,
  includeFlexibleBuffer: boolean,
) {
  let gap = bufferSettings.before_events + bufferSettings.after_events;
  if (isTaskOrHabit(candidateType) || isTaskOrHabit(existingType)) {
    gap += bufferSettings.between_task_habits;
  }
  if (includeFlexibleBuffer) {
    gap += bufferSettings.travel_time;
  }
  return gap;
}

export function findConflict(
  tasks: TaskItem[],
  dateKey: string,
  startMinutes: number,
  duration: number,
  excludeId?: string,
) {
  return tasks.find(
    (task) =>
      !task.done &&
      isSchedulableTask(task) &&
      task.id !== excludeId &&
      task.scheduled_date === dateKey &&
      overlaps(task.start_minutes, task.duration, startMinutes, duration),
  );
}

function findSlotOnDate(
  tasks: TaskItem[],
  dateKey: string,
  task: Pick<TaskItem, 'duration' | 'type'>,
  startMinutes: number,
  windowStart: number,
  windowEnd: number,
  bufferSettings: BufferSettings,
  includeFlexibleBuffer: boolean,
  excludeId?: string,
) {
  const normalizedWindowStart = clampStart(windowStart, task.duration);
  const normalizedWindowEnd = Math.min(windowEnd, MINUTES_IN_DAY);
  const firstStart = clampStart(Math.max(normalizedWindowStart, startMinutes), task.duration);
  for (let cursor = firstStart; cursor + task.duration <= normalizedWindowEnd; cursor += SNAP_MINUTES) {
    const collision = tasks.find((entry) => {
      if (entry.done || !isSchedulableTask(entry) || entry.id === excludeId || entry.scheduled_date !== dateKey) {
        return false;
      }

      const gap = pairGapMinutes(task.type, entry.type, bufferSettings, includeFlexibleBuffer);
      return overlaps(cursor, task.duration, entry.start_minutes - gap, entry.duration + gap * 2);
    });

    if (!collision) {
      return cursor;
    }
  }
  return null;
}

function normalizeRanges(ranges: Array<Pick<TimeRange, 'start_minutes' | 'end_minutes'>> | undefined) {
  const normalized = (ranges ?? [])
    .map((range) => ({
      start_minutes: Math.max(0, Math.min(MINUTES_IN_DAY, snapMinutes(range.start_minutes))),
      end_minutes: Math.max(0, Math.min(MINUTES_IN_DAY, snapMinutes(range.end_minutes))),
    }))
    .filter((range) => range.end_minutes > range.start_minutes)
    .sort((left, right) => left.start_minutes - right.start_minutes);

  if (normalized.length === 0) {
    return [{ start_minutes: AUTO_START_MINUTES, end_minutes: AUTO_END_MINUTES }];
  }

  return normalized;
}

export function getTaskWindows(task: Pick<TaskItem, 'hours_ranges' | 'hours_start' | 'hours_end'>) {
  if (task.hours_ranges && task.hours_ranges.length > 0) {
    return normalizeRanges(task.hours_ranges);
  }

  return normalizeRanges([
    {
      start_minutes: task.hours_start ?? AUTO_START_MINUTES,
      end_minutes: task.hours_end ?? AUTO_END_MINUTES,
    },
  ]);
}

export function isWithinTaskWindows(
  task: Pick<TaskItem, 'hours_ranges' | 'hours_start' | 'hours_end'>,
  startMinutes: number,
  duration: number,
) {
  return getTaskWindows(task).some(
    (window) => startMinutes >= window.start_minutes && startMinutes + duration <= window.end_minutes,
  );
}

export function isFlexibleTask(task: Pick<TaskItem, 'min_duration' | 'max_duration'>) {
  return Boolean(task.min_duration || task.max_duration);
}

function toBlock(task: TaskItem): ScheduleBlock {
  return {
    id: task.id,
    task_id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    priority: task.priority,
    duration: task.duration,
    scheduled_date: task.scheduled_date,
    start_minutes: task.start_minutes,
    hours_ranges: task.hours_ranges,
    deadline: task.deadline,
    done: task.done,
    is_split_segment: false,
    segment_index: 1,
    segment_count: 1,
  };
}

function compareTaskImportance(left: TaskItem, right: TaskItem) {
  const priorityDifference = priorityWeight[left.priority] - priorityWeight[right.priority];
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const dueDifference = compareDueMoments(taskDueValue(left), taskDueValue(right));
  if (dueDifference !== 0) {
    return dueDifference;
  }


  const leftScheduleAfter = taskEarliestDate(left);
  const rightScheduleAfter = taskEarliestDate(right);
  if (leftScheduleAfter !== rightScheduleAfter) {
    return leftScheduleAfter.localeCompare(rightScheduleAfter);
  }

  return left.title.localeCompare(right.title);
}

function normalizeComparableDueValue(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;

  const normalized = value.includes('T') || value.includes(' ')
    ? value.replace(' ', 'T')
    : `${value}T23:59:59`;

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareDueMoments(left?: string, right?: string) {
  return normalizeComparableDueValue(left) - normalizeComparableDueValue(right);
}

function preferredDate(task: TaskItem) {
  return taskEarliestDate(task);
}

function preferredStart(task: TaskItem) {
  return taskEarliestStart(task);
}

function buildDateSpan(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let dateKey = startDate; dateKey <= endDate; dateKey = addDays(dateKey, 1)) {
    dates.push(dateKey);
  }
  return dates;
}

function compareHabitPreference(left: TaskItem, right: TaskItem) {
  const importanceDifference = compareTaskImportance(left, right);
  if (importanceDifference !== 0) {
    return importanceDifference;
  }

  const leftDate = preferredDate(left);
  const rightDate = preferredDate(right);
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return preferredStart(left) - preferredStart(right);
}

function compareFocusFlexibility(left: TaskItem, right: TaskItem) {
  const importanceDifference = compareTaskImportance(left, right);
  if (importanceDifference !== 0) {
    return importanceDifference;
  }

  const leftDuration = left.duration;
  const rightDuration = right.duration;
  if (leftDuration !== rightDuration) {
    return leftDuration - rightDuration;
  }

  return preferredStart(left) - preferredStart(right);
}

function getTaskHorizon(task: TaskItem, startDate: string, endDate: string) {
  const earliest = preferredDate(task) > startDate ? preferredDate(task) : startDate;
  const naturalLatest =
    dateKeyFromDateTime(task.due_at) ||
    task.deadline ||
    addDays(task.scheduled_date, task.type === 'buffer' ? 2 : 7);

  const latest = naturalLatest > endDate ? endDate : naturalLatest;

  return {
    earliest,
    latest: latest >= earliest ? latest : earliest,
  };
}

function getBlockMapForDate(blocksByDate: Map<string, ScheduleBlock[]>, dateKey: string) {
  return blocksByDate.get(dateKey) ?? [];
}

function pushBlock(blocksByDate: Map<string, ScheduleBlock[]>, block: ScheduleBlock) {
  const current = blocksByDate.get(block.scheduled_date) ?? [];
  current.push(block);
  current.sort((left, right) => left.start_minutes - right.start_minutes);
  blocksByDate.set(block.scheduled_date, current);
}

function findBufferedGaps(
  blocks: ScheduleBlock[],
  candidateType: TaskItem['type'],
  windowStart: number,
  windowEnd: number,
  bufferSettings: BufferSettings,
  includeFlexibleBuffer: boolean,
) {
  const relevant = [...blocks]
    .filter((block) => block.start_minutes < windowEnd && block.start_minutes + block.duration > windowStart)
    .map((block) => {
      const gap = pairGapMinutes(candidateType, block.type, bufferSettings, includeFlexibleBuffer);
      return {
        start: Math.max(windowStart, block.start_minutes - gap),
        end: Math.min(windowEnd, block.start_minutes + block.duration + gap),
      };
    })
    .sort((left, right) => left.start - right.start);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = windowStart;

  relevant.forEach((block) => {
    if (block.start > cursor) {
      gaps.push({ start: cursor, end: block.start });
    }
    cursor = Math.max(cursor, block.end);
  });

  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd });
  }

  return gaps;
}

function findDiscretePlacement(
  task: TaskItem,
  blocksByDate: Map<string, ScheduleBlock[]>,
  startDate: string,
  endDate: string,
  bufferSettings: BufferSettings,
  includeFlexibleBuffer: boolean,
  nowDateKey = '',
  nowMinutes = 0,
) {
  const { earliest, latest } = getTaskHorizon(task, startDate, endDate);
  const preferred = task.scheduled_date;
  const preferredMinute = preferredStart(task);
  const candidateDates = buildDateSpan(earliest, latest).sort((left, right) => {
    const leftDistance = Math.abs(fromDateKey(left).getTime() - fromDateKey(preferred).getTime());
    const rightDistance = Math.abs(fromDateKey(right).getTime() - fromDateKey(preferred).getTime());
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left.localeCompare(right);
  });

  for (const dateKey of candidateDates) {
    const dateBlocks = getBlockMapForDate(blocksByDate, dateKey);
    const windows = getTaskWindows(task);
    const nowFloor = nowDateKey && dateKey === nowDateKey ? nowMinutes : 0;
    const earliestFloor = taskEarliestFloorForDate(task, dateKey);
    const dayFloor = Math.max(nowFloor, earliestFloor);

    for (const window of windows) {
      const gaps = findBufferedGaps(dateBlocks, task.type, window.start_minutes, window.end_minutes, bufferSettings, includeFlexibleBuffer);
      const fittingSlots = gaps
        .filter((gap) => gap.end > Math.max(gap.start, dayFloor) && gap.end - Math.max(gap.start, dayFloor) >= task.duration)
        .map((gap) => {
          const effectiveGapStart = Math.max(gap.start, dayFloor);
          const desired = clampStart(
            dateKey === preferred ? preferredMinute : Math.max(window.start_minutes, earliestFloor),
            task.duration,
          );
          const start = Math.min(Math.max(effectiveGapStart, desired), gap.end - task.duration);
          return {
            start,
            score: Math.abs(start - desired),
          };
        })
        .sort((left, right) => left.score - right.score || left.start - right.start);

      if (fittingSlots.length > 0) {
        return {
          scheduled_date: dateKey,
          start_minutes: fittingSlots[0].start,
        };
      }
    }
  }

  return null;
}

function normalizeChunkBounds(task: TaskItem) {
  if (task.type === 'buffer') {
    return {
      minDuration: task.duration,
      maxDuration: task.duration,
    };
  }

  if (task.type === 'focus') {
    const minDuration = Math.min(task.duration, Math.max(task.min_duration ?? 30, SNAP_MINUTES));
    return {
      minDuration,
      maxDuration: Math.min(task.duration, Math.max(task.max_duration ?? Math.min(task.duration, 120), minDuration)),
    };
  }

  const minDuration = Math.min(task.duration, Math.max(task.min_duration ?? 30, SNAP_MINUTES));
  return {
    minDuration,
    maxDuration: Math.min(task.duration, Math.max(task.max_duration ?? task.duration, minDuration)),
  };
}

function allocateSplitBlocks(
  task: TaskItem,
  blocksByDate: Map<string, ScheduleBlock[]>,
  startDate: string,
  endDate: string,
  bufferSettings: BufferSettings,
  allowPartial: boolean,
  includeFlexibleBuffer: boolean,
  nowDateKey = '',
  nowMinutes = 0,
) {
  const { earliest, latest } = getTaskHorizon(task, startDate, endDate);
  const { minDuration, maxDuration } = normalizeChunkBounds(task);
  const candidateEnd = allowPartial ? endDate : latest;
  let remaining = task.duration;
  let segmentIndex = 0;
  const createdBlocks: ScheduleBlock[] = [];

  for (let dateKey = earliest; dateKey <= candidateEnd && remaining > 0; dateKey = addDays(dateKey, 1)) {
    const dateBlocks = getBlockMapForDate(blocksByDate, dateKey);
    const windows = getTaskWindows(task);
    // Never schedule before current time on today's date.
    const nowFloor = nowDateKey && dateKey === nowDateKey ? nowMinutes : 0;
    const earliestFloor = taskEarliestFloorForDate(task, dateKey);
    const dayTimeFloor = Math.max(nowFloor, earliestFloor);

    for (const window of windows) {
      if (remaining <= 0) {
        break;
      }

      const gaps = findBufferedGaps(dateBlocks, task.type, window.start_minutes, window.end_minutes, bufferSettings, includeFlexibleBuffer);
      for (const gap of gaps) {
        if (remaining <= 0) {
          break;
        }

        // Clip gap start to the time floor — don't schedule before "now" on the first day
        const effectiveStart = Math.max(gap.start, dayTimeFloor);
        if (effectiveStart >= gap.end) {
          continue;
        }

        const chunk = fitChunkDuration(remaining, gap.end - effectiveStart, minDuration, maxDuration);
        if (!chunk) {
          continue;
        }

        segmentIndex += 1;
        const block: ScheduleBlock = {
          id: `${task.id}::${segmentIndex}`,
          task_id: task.id,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          duration: chunk,
          scheduled_date: dateKey,
          start_minutes: effectiveStart,
          hours_ranges: task.hours_ranges,
          deadline: task.deadline,
          done: task.done,
          is_split_segment: true,
          segment_index: segmentIndex,
          segment_count: 0,
        };

        remaining -= chunk;
        createdBlocks.push(block);
        pushBlock(blocksByDate, block);
      }
    }
  }

  if (!allowPartial && remaining > 0) {
    createdBlocks.forEach((block) => {
      const dateBlocks = getBlockMapForDate(blocksByDate, block.scheduled_date).filter((entry) => entry.id !== block.id);
      blocksByDate.set(block.scheduled_date, dateBlocks);
    });
    return [];
  }

  createdBlocks.forEach((block) => {
    block.segment_count = createdBlocks.length || 1;
  });

  return createdBlocks;
}

function findFreeGaps(blocks: ScheduleBlock[], windowStart: number, windowEnd: number) {
  const relevant = [...blocks]
    .filter((block) => block.start_minutes < windowEnd && block.start_minutes + block.duration > windowStart)
    .sort((left, right) => left.start_minutes - right.start_minutes);

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = windowStart;

  relevant.forEach((block) => {
    if (block.start_minutes > cursor) {
      gaps.push({ start: cursor, end: block.start_minutes });
    }
    cursor = Math.max(cursor, block.start_minutes + block.duration);
  });

  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd });
  }

  return gaps;
}

function fitChunkDuration(remaining: number, gapSize: number, minDuration: number, maxDuration: number) {
  let candidate = Math.min(remaining, gapSize, maxDuration);
  candidate = Math.floor(candidate / SNAP_MINUTES) * SNAP_MINUTES;

  for (let duration = candidate; duration >= minDuration; duration -= SNAP_MINUTES) {
    const nextRemaining = remaining - duration;
    if (nextRemaining === 0 || nextRemaining >= minDuration) {
      return duration;
    }
  }

  if (remaining <= maxDuration && remaining <= gapSize && remaining >= minDuration) {
    return remaining;
  }

  return null;
}

export function buildScheduleBlocks(
  tasks: TaskItem[],
  startDate: string,
  endDate: string,
  bufferSettings: BufferSettings = DEFAULT_BUFFER_SETTINGS,
  nowDateKey = '',
  nowMinutes = 0,
): ScheduleBlock[] {
  const schedulableTasks = tasks.filter(isSchedulableTask);
  const blocksByDate = new Map<string, ScheduleBlock[]>();
  const doneTasks = schedulableTasks.filter((task) => task.done);
  const activeTasks = schedulableTasks.filter((task) => !task.done);

  // Manually-pinned tasks: placed first at their exact stored position.
  // They occupy their slot in blocksByDate so auto-placed tasks avoid them.
  const pinnedTasks = activeTasks.filter((task) => task.is_pinned);
  const autoTasks = activeTasks.filter((task) => !task.is_pinned);

  const habitTasks = sortTasksChronologically(autoTasks.filter((task) => task.type === 'buffer')).sort(compareHabitPreference);
  const taskItems = sortTasksChronologically(autoTasks.filter((task) => task.type === 'task')).sort(compareTaskImportance);
  const focusItems = sortTasksChronologically(autoTasks.filter((task) => task.type === 'focus')).sort(compareFocusFlexibility);

  // Done tasks are shown in the UI but do NOT occupy slots for scheduling.
  const optimizedBlocks: ScheduleBlock[] = doneTasks.map(toBlock);

  // Place pinned tasks first — they render at their exact stored position.
  pinnedTasks.forEach((task) => {
    const block = toBlock(task);
    pushBlock(blocksByDate, block);
    optimizedBlocks.push(block);
  });

  habitTasks.forEach((task) => {
    const placement =
      findDiscretePlacement(task, blocksByDate, startDate, endDate, bufferSettings, true, nowDateKey, nowMinutes) ??
      findDiscretePlacement(task, blocksByDate, startDate, endDate, bufferSettings, false, nowDateKey, nowMinutes);
    if (!placement) {
      return;
    }
    const block = toBlock({
      ...task,
      scheduled_date: placement.scheduled_date,
      start_minutes: placement.start_minutes,
    });
    pushBlock(blocksByDate, block);
    optimizedBlocks.push(block);
  });

  taskItems.forEach((task) => {
    const firstPassBlocks = allocateSplitBlocks(task, blocksByDate, startDate, endDate, bufferSettings, false, true, nowDateKey, nowMinutes);
    const blocks = firstPassBlocks.length > 0
      ? firstPassBlocks
      : allocateSplitBlocks(task, blocksByDate, startDate, endDate, bufferSettings, false, false, nowDateKey, nowMinutes);
    if (blocks.length > 0) {
      optimizedBlocks.push(...blocks);
      return;
    }

    const fallback = findPlacement(activeTasks, task, task.scheduled_date, preferredStart(task), bufferSettings, task.id);
    if (!fallback) {
      return;
    }

    const block = toBlock({
      ...task,
      scheduled_date: fallback.scheduled_date,
      start_minutes: fallback.start_minutes,
    });
    pushBlock(blocksByDate, block);
    optimizedBlocks.push(block);
  });

  focusItems.forEach((task) => {
    const firstPassBlocks = allocateSplitBlocks(task, blocksByDate, startDate, endDate, bufferSettings, true, true, nowDateKey, nowMinutes);
    const blocks = firstPassBlocks.length > 0
      ? firstPassBlocks
      : allocateSplitBlocks(task, blocksByDate, startDate, endDate, bufferSettings, true, false, nowDateKey, nowMinutes);
    optimizedBlocks.push(...blocks);
  });

  return optimizedBlocks.sort((left, right) => {
    if (left.scheduled_date === right.scheduled_date) {
      return left.start_minutes - right.start_minutes;
    }
    return left.scheduled_date.localeCompare(right.scheduled_date);
  });
}

export function findPlacement(
  tasks: TaskItem[],
  task: Pick<TaskItem, 'type' | 'duration' | 'deadline' | 'schedule_after' | 'hours_ranges' | 'hours_start' | 'hours_end' | 'earliest_start_at' | 'due_at'>,
  preferredDate: string,
  preferredStart: number,
  bufferSettings: BufferSettings = DEFAULT_BUFFER_SETTINGS,
  excludeId?: string,
) {
  const exactEarliestDate = dateKeyFromDateTime(task.earliest_start_at);
  const exactEarliestStart = minutesFromDateTime(task.earliest_start_at, preferredStart);
  const scheduleAfterDate = exactEarliestDate || task.schedule_after || preferredDate;
  const earliestDate = scheduleAfterDate > preferredDate ? scheduleAfterDate : preferredDate;
  const deadlineDate = dateKeyFromDateTime(task.due_at) || task.deadline;
  const deadline = deadlineDate && deadlineDate >= earliestDate ? deadlineDate : earliestDate;
  const windows = getTaskWindows(task);

  const attempt = (includeFlexibleBuffer: boolean, searchStartDate: string, forceAfterDeadline = false) => {
    for (let offset = 0; offset <= AUTO_LOOKAHEAD_DAYS; offset += 1) {
      const dateKey = addDays(searchStartDate, offset);
      const slot = windows
        .map((window) =>
          findSlotOnDate(
            tasks,
            dateKey,
            task,
            offset === 0
              ? Math.max(preferredStart, exactEarliestDate === dateKey ? exactEarliestStart : window.start_minutes)
              : Math.max(window.start_minutes, exactEarliestDate === dateKey ? exactEarliestStart : window.start_minutes),
            window.start_minutes,
            window.end_minutes,
            bufferSettings,
            includeFlexibleBuffer,
            excludeId,
          ),
        )
        .find((value): value is number => value !== null);
      if (slot !== undefined) {
        return {
          scheduled_date: dateKey,
          start_minutes: slot,
          afterDeadline: forceAfterDeadline || Boolean(deadlineDate && dateKey > deadline),
        };
      }
      if (!forceAfterDeadline && dateKey >= deadline && deadlineDate) {
        break;
      }
    }
    return null;
  };

  const firstPass = attempt(true, earliestDate) ?? attempt(false, earliestDate);
  if (firstPass) {
    return firstPass;
  }

  if (!deadlineDate) {
    return null;
  }

  return attempt(true, deadline, true) ?? attempt(false, deadline, true);
}


export function autoPlaceDay(tasks: TaskItem[], dateKey: string, bufferSettings: BufferSettings = DEFAULT_BUFFER_SETTINGS) {
  const schedulableTasks = tasks.filter(isSchedulableTask);
  const seeds = [
    dateKey,
    ...schedulableTasks.map((task) => task.schedule_after ?? task.scheduled_date),
  ];
  const planningStart = seeds.reduce((earliest, current) => (current < earliest ? current : earliest));
  const planningEnd = addDays(
    schedulableTasks
      .map((task) => dateKeyFromDateTime(task.due_at) || task.deadline || task.scheduled_date)
      .reduce((latest, current) => (current > latest ? current : latest), dateKey),
    14,
  );
  const optimizedBlocks = buildScheduleBlocks(schedulableTasks, planningStart, planningEnd, bufferSettings);
  const firstBlocks = new Map<string, ScheduleBlock>();

  optimizedBlocks.forEach((block) => {
    if (!firstBlocks.has(block.task_id)) {
      firstBlocks.set(block.task_id, block);
    }
  });

  let moved = 0;
  let unresolved = 0;
  const nextTasks = sortTasksChronologically(
    tasks.map((task) => {
      if (task.done || !isSchedulableTask(task)) {
        return task;
      }

      const firstBlock = firstBlocks.get(task.id);
      if (!firstBlock) {
        if (task.scheduled_date === dateKey) {
          unresolved += 1;
        }
        return task;
      }

      if (task.scheduled_date === dateKey && (task.scheduled_date !== firstBlock.scheduled_date || task.start_minutes !== firstBlock.start_minutes)) {
        moved += 1;
      }

      return {
        ...task,
        scheduled_date: firstBlock.scheduled_date,
        start_minutes: firstBlock.start_minutes,
      };
    }),
  );

  return {
    tasks: nextTasks,
    moved,
    unresolved,
  };
}

export function buildWarnings(
  tasks: TaskItem[],
  todayKey: string,
  selectedDate: string,
  bufferSettings: BufferSettings = DEFAULT_BUFFER_SETTINGS,
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const activeTasks = tasks.filter((task) => !task.done && isSchedulableTask(task));
  const planningDates = activeTasks.length > 0
    ? {
        start: activeTasks
          .map((task) => task.schedule_after ?? task.scheduled_date)
          .reduce((earliest, current) => (current < earliest ? current : earliest)),
        end: addDays(
          activeTasks
            .map((task) => dateKeyFromDateTime(task.due_at) || task.deadline || task.scheduled_date)
            .reduce((latest, current) => (current > latest ? current : latest)),
          14,
        ),
      }
    : null;
  const optimizedBlocks = planningDates ? buildScheduleBlocks(activeTasks, planningDates.start, planningDates.end, bufferSettings) : [];
  const blocksByTask = new Map<string, ScheduleBlock[]>();

  optimizedBlocks.forEach((block) => {
    const current = blocksByTask.get(block.task_id) ?? [];
    current.push(block);
    blocksByTask.set(block.task_id, current);
  });

  const nowMs = Date.now();

  activeTasks.forEach((task) => {
    if (!task.deadline && !task.due_at) {
      return;
    }

    const taskBlocks = blocksByTask.get(task.id) ?? [];
    const firstBlock = taskBlocks[0];
    const lastBlock = taskBlocks[taskBlocks.length - 1];
    const effectiveScheduledDate = firstBlock?.scheduled_date ?? task.scheduled_date;

    // Compute deadline date and exact due timestamp for time-aware checks
    const deadlineDate = dateKeyFromDateTime(task.due_at) || task.deadline;
    if (!deadlineDate) return;

    // "Late" check: last scheduled block is after the deadline date.
    // If due_at is set, also check whether the block end time exceeds due_at.
    const lastBlockDate = lastBlock?.scheduled_date;
    const lastBlockEndMs = lastBlock
      ? new Date(lastBlock.scheduled_date + 'T00:00:00').getTime() + (lastBlock.start_minutes + lastBlock.duration) * 60_000
      : null;
    const dueAtMs = task.due_at ? new Date(task.due_at).getTime() : null;

    const isLate = lastBlockDate
      ? lastBlockDate > deadlineDate || (dueAtMs !== null && lastBlockEndMs !== null && lastBlockEndMs > dueAtMs)
      : false;

    if (isLate) {
      warnings.push({
        id: `late-${task.id}`,
        severity: 'critical',
        title: `${task.title} is scheduled after its deadline`,
        detail: `Currently on ${formatDate(lastBlockDate ?? deadlineDate, { month: 'short', day: 'numeric' })}; deadline ${formatDate(deadlineDate, {
          month: 'short',
          day: 'numeric',
        })}.`,
      });
      return;
    }

    // "Overdue" check: deadline date is in the past, or due_at timestamp already passed.
    const isOverdue = dueAtMs !== null ? dueAtMs < nowMs : deadlineDate < todayKey;
    if (isOverdue) {
      warnings.push({
        id: `overdue-${task.id}`,
        severity: 'critical',
        title: `${task.title} is overdue`,
        detail: `Deadline passed on ${formatDate(deadlineDate, { month: 'short', day: 'numeric' })}.`,
      });
      return;
    }

    const distanceToDeadline =
      (fromDateKey(deadlineDate).getTime() - fromDateKey(todayKey).getTime()) / (1000 * 60 * 60 * 24);

    if ((task.priority === 'critical' || task.priority === 'high') && distanceToDeadline <= 1) {
      warnings.push({
        id: `high-${task.id}`,
        severity: 'warning',
        title: `${task.title} needs attention soon`,
        detail: `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority and due ${distanceToDeadline <= 0 ? 'today' : 'tomorrow'} at the latest.`,
      });
      return;
    }

    if (task.priority !== 'low' && distanceToDeadline <= 2) {
      warnings.push({
        id: `soon-${task.id}`,
        severity: 'notice',
        title: `${task.title} is approaching its deadline`,
        detail: `Scheduled ${formatDate(effectiveScheduledDate, { weekday: 'short', month: 'short', day: 'numeric' })}.`,
      });
    }
  });

  const selectedDayItems = optimizedBlocks
    .filter((task) => task.scheduled_date === selectedDate)
    .sort((left, right) => left.start_minutes - right.start_minutes);
  for (let index = 0; index < selectedDayItems.length - 1; index += 1) {
    const current = selectedDayItems[index];
    const next = selectedDayItems[index + 1];
    if (overlaps(current.start_minutes, current.duration, next.start_minutes, next.duration)) {
      warnings.push({
        id: `conflict-${current.id}-${next.id}`,
        severity: 'critical',
        title: `Conflict on ${formatDate(selectedDate, { weekday: 'long', month: 'short', day: 'numeric' })}`,
        detail: `${current.title} overlaps with ${next.title}.`,
      });
    }
  }

  const severityOrder = { critical: 0, warning: 1, notice: 2 };
  return warnings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}
