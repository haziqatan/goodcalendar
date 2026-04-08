export type TaskType = 'task' | 'focus' | 'buffer';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  deadline?: string;
  scheduled_date: string;
  start_minutes: number;
  done: boolean;
}

export interface ScheduleStats {
  tasks: number;
  focusMinutes: number;
  bufferMinutes: number;
  completionRate: number;
}
