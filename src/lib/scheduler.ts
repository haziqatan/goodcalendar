import type { ScheduleBlock, ScheduleWarning, TaskItem, TaskPriority, TimeRange } from '../types';

export const MINUTES_IN_DAY = 24 * 60;
export const SNAP_MINUTES = 15;
export const AUTO_START_MINUTES = 8 * 60;
export const AUTO_END_MINUTES = 20 * 60;
export const PIXELS_PER_MINUTE = 1.05;
const AUTO_LOOKAHEAD_DAYS = 7;

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

export function findConflict(
  tasks: TaskItem[],
  dateKey: string,
  startMinutes: number,
  duration: number,
  excludeId?: string,
) {
  return tasks.find(
    (task) =>
      task.id !== excludeId &&
      task.scheduled_date === dateKey &&
      overlaps(task.start_minutes, task.duration, startMinutes, duration),
  );
}

function findSlotOnDate(
  tasks: TaskItem[],
  dateKey: string,
  duration: number,
  startMinutes: number,
  windowStart: number,
  windowEnd: number,
  excludeId?: string,
) {
  const normalizedWindowStart = clampStart(windowStart, duration);
  const normalizedWindowEnd = Math.min(windowEnd, MINUTES_IN_DAY);
  const firstStart = clampStart(Math.max(normalizedWindowStart, startMinutes), duration);
  for (let cursor = firstStart; cursor + duration <= normalizedWindowEnd; cursor += SNAP_MINUTES) {
    if (!findConflict(tasks, dateKey, cursor, duration, excludeId)) {
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

  const leftDeadline = left.deadline ?? '9999-12-31';
  const rightDeadline = right.deadline ?? '9999-12-31';
  if (leftDeadline !== rightDeadline) {
    return leftDeadline.localeCompare(rightDeadline);
  }

  const leftScheduleAfter = left.schedule_after ?? left.scheduled_date;
  const rightScheduleAfter = right.schedule_after ?? right.scheduled_date;
  if (leftScheduleAfter !== rightScheduleAfter) {
    return leftScheduleAfter.localeCompare(rightScheduleAfter);
  }

  return left.title.localeCompare(right.title);
}

function preferredDate(task: TaskItem) {
  return task.schedule_after ?? task.scheduled_date;
}

function preferredStart(task: TaskItem) {
  const windows = getTaskWindows(task);
  return Math.min(
    Math.max(task.start_minutes, windows[0]?.start_minutes ?? AUTO_START_MINUTES),
    (windows[windows.length - 1]?.end_minutes ?? AUTO_END_MINUTES) - SNAP_MINUTES,
  );
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
  const naturalLatest = task.deadline ?? addDays(task.scheduled_date, task.type === 'buffer' ? 2 : 7);
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

function findDiscretePlacement(
  task: TaskItem,
  blocksByDate: Map<string, ScheduleBlock[]>,
  startDate: string,
  endDate: string,
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

    for (const window of windows) {
      const gaps = findFreeGaps(dateBlocks, window.start_minutes, window.end_minutes);
      const fittingSlots = gaps
        .filter((gap) => gap.end - gap.start >= task.duration)
        .map((gap) => {
          const desired = clampStart(
            dateKey === preferred ? preferredMinute : Math.max(window.start_minutes, task.start_minutes),
            task.duration,
          );
          const start = Math.min(Math.max(gap.start, desired), gap.end - task.duration);
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
  allowPartial: boolean,
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

    for (const window of windows) {
      if (remaining <= 0) {
        break;
      }

      const gaps = findFreeGaps(dateBlocks, window.start_minutes, window.end_minutes);
      for (const gap of gaps) {
        if (remaining <= 0) {
          break;
        }

        const chunk = fitChunkDuration(remaining, gap.end - gap.start, minDuration, maxDuration);
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
          start_minutes: gap.start,
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

export function buildScheduleBlocks(tasks: TaskItem[], startDate: string, endDate: string): ScheduleBlock[] {
  const blocksByDate = new Map<string, ScheduleBlock[]>();
  const lockedTasks = sortTasksChronologically(tasks.filter((task) => task.done));
  const habitTasks = sortTasksChronologically(tasks.filter((task) => !task.done && task.type === 'buffer')).sort(compareHabitPreference);
  const taskItems = sortTasksChronologically(tasks.filter((task) => !task.done && task.type === 'task')).sort(compareTaskImportance);
  const focusItems = sortTasksChronologically(tasks.filter((task) => !task.done && task.type === 'focus')).sort(compareFocusFlexibility);

  lockedTasks.forEach((task) => {
    const block = toBlock(task);
    pushBlock(blocksByDate, block);
  });

  const optimizedBlocks: ScheduleBlock[] = lockedTasks.map(toBlock);

  habitTasks.forEach((task) => {
    const placement = findDiscretePlacement(task, blocksByDate, startDate, endDate);
    const block = toBlock({
      ...task,
      scheduled_date: placement?.scheduled_date ?? task.scheduled_date,
      start_minutes: placement?.start_minutes ?? task.start_minutes,
    });
    pushBlock(blocksByDate, block);
    optimizedBlocks.push(block);
  });

  taskItems.forEach((task) => {
    const blocks = allocateSplitBlocks(task, blocksByDate, startDate, endDate, false);
    if (blocks.length > 0) {
      optimizedBlocks.push(...blocks);
      return;
    }

    const fallback = findPlacement(tasks, task, task.scheduled_date, preferredStart(task), task.id);
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
    const blocks = allocateSplitBlocks(task, blocksByDate, startDate, endDate, true);
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
  task: Pick<TaskItem, 'duration' | 'deadline' | 'schedule_after' | 'hours_ranges' | 'hours_start' | 'hours_end'>,
  preferredDate: string,
  preferredStart: number,
  excludeId?: string,
) {
  const earliestDate = task.schedule_after && task.schedule_after > preferredDate ? task.schedule_after : preferredDate;
  const deadline = task.deadline && task.deadline >= earliestDate ? task.deadline : earliestDate;
  const windows = getTaskWindows(task);

  for (let offset = 0; offset <= AUTO_LOOKAHEAD_DAYS; offset += 1) {
    const dateKey = addDays(earliestDate, offset);
    const slot = windows
      .map((window) =>
        findSlotOnDate(
          tasks,
          dateKey,
          task.duration,
          offset === 0 ? preferredStart : window.start_minutes,
          window.start_minutes,
          window.end_minutes,
          excludeId,
        ),
      )
      .find((value): value is number => value !== null);
    if (slot !== undefined) {
      return {
        scheduled_date: dateKey,
        start_minutes: slot,
        afterDeadline: Boolean(task.deadline && dateKey > deadline),
      };
    }
    if (dateKey >= deadline && task.deadline) {
      break;
    }
  }

  if (!task.deadline) {
    return null;
  }

  for (let offset = 0; offset <= AUTO_LOOKAHEAD_DAYS; offset += 1) {
    const dateKey = addDays(deadline, offset);
    const slot = windows
      .map((window) =>
        findSlotOnDate(tasks, dateKey, task.duration, window.start_minutes, window.start_minutes, window.end_minutes, excludeId),
      )
      .find((value): value is number => value !== null);
    if (slot !== undefined) {
      return {
        scheduled_date: dateKey,
        start_minutes: slot,
        afterDeadline: true,
      };
    }
  }

  return null;
}

function compareDeadline(left?: string, right?: string) {
  if (left && right) {
    return left.localeCompare(right);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

export function autoPlaceDay(tasks: TaskItem[], dateKey: string) {
  const stationaryTasks = sortTasksChronologically(tasks.filter((task) => task.scheduled_date !== dateKey));
  const orderedDayItems = sortTasksChronologically(tasks)
    .filter((task) => task.scheduled_date === dateKey)
    .sort((left, right) => {
      if (left.done !== right.done) {
        return Number(left.done) - Number(right.done);
      }
      const priorityDifference = priorityWeight[left.priority] - priorityWeight[right.priority];
      if (priorityDifference !== 0) {
        return priorityDifference;
      }
      const deadlineDifference = compareDeadline(left.deadline, right.deadline);
      if (deadlineDifference !== 0) {
        return deadlineDifference;
      }
      return left.start_minutes - right.start_minutes;
    });

  let moved = 0;
  let unresolved = 0;
  let searchFrom = AUTO_START_MINUTES;
  const placedTasks: TaskItem[] = [];

  orderedDayItems.forEach((task) => {
    const windows = getTaskWindows(task);
    const slot = windows
      .map((window) =>
        findSlotOnDate(
          [...stationaryTasks, ...placedTasks],
          dateKey,
          task.duration,
          Math.max(searchFrom, window.start_minutes),
          window.start_minutes,
          window.end_minutes,
          task.id,
        ),
      )
      .find((value): value is number => value !== null);
    if (slot === undefined) {
      unresolved += 1;
      placedTasks.push(task);
      return;
    }

    searchFrom = slot + task.duration;
    if (slot !== task.start_minutes) {
      moved += 1;
      placedTasks.push({ ...task, start_minutes: slot });
      return;
    }
    placedTasks.push(task);
  });

  return {
    tasks: sortTasksChronologically([...stationaryTasks, ...placedTasks]),
    moved,
    unresolved,
  };
}

export function buildWarnings(tasks: TaskItem[], todayKey: string, selectedDate: string): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const activeTasks = tasks.filter((task) => !task.done);
  const planningDates = activeTasks.length > 0
    ? {
        start: activeTasks
          .map((task) => task.schedule_after ?? task.scheduled_date)
          .reduce((earliest, current) => (current < earliest ? current : earliest)),
        end: addDays(
          activeTasks
            .map((task) => task.deadline ?? task.scheduled_date)
            .reduce((latest, current) => (current > latest ? current : latest)),
          14,
        ),
      }
    : null;
  const optimizedBlocks = planningDates ? buildScheduleBlocks(activeTasks, planningDates.start, planningDates.end) : [];
  const blocksByTask = new Map<string, ScheduleBlock[]>();

  optimizedBlocks.forEach((block) => {
    const current = blocksByTask.get(block.task_id) ?? [];
    current.push(block);
    blocksByTask.set(block.task_id, current);
  });

  activeTasks.forEach((task) => {
    if (!task.deadline) {
      return;
    }

    const taskBlocks = blocksByTask.get(task.id) ?? [];
    const firstBlock = taskBlocks[0];
    const lastBlock = taskBlocks[taskBlocks.length - 1];
    const effectiveScheduledDate = firstBlock?.scheduled_date ?? task.scheduled_date;

    if (lastBlock && lastBlock.scheduled_date > task.deadline) {
      warnings.push({
        id: `late-${task.id}`,
        severity: 'critical',
        title: `${task.title} is scheduled after its deadline`,
        detail: `Currently on ${formatDate(lastBlock.scheduled_date, { month: 'short', day: 'numeric' })}; deadline ${formatDate(task.deadline, {
          month: 'short',
          day: 'numeric',
        })}.`,
      });
      return;
    }

    if (task.deadline < todayKey) {
      warnings.push({
        id: `overdue-${task.id}`,
        severity: 'critical',
        title: `${task.title} is overdue`,
        detail: `Deadline passed on ${formatDate(task.deadline, { month: 'short', day: 'numeric' })}.`,
      });
      return;
    }

    const distanceToDeadline =
      (fromDateKey(task.deadline).getTime() - fromDateKey(todayKey).getTime()) / (1000 * 60 * 60 * 24);

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
