export type TaskType = 'task' | 'focus' | 'buffer';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type WarningSeverity = 'critical' | 'warning' | 'notice';

export interface TimeRange {
  start_minutes: number;
  end_minutes: number;
}

export interface BufferSettings {
  before_events: number;
  after_events: number;
  between_task_habits: number;
  travel_time: number;
}

export interface WorkflowStage {
  id: string;
  name: string;
  enabled: boolean;
  days: number;        // auto-suggested (proportional), user-editable; 0.5 = 4 h
  weight: number;      // relative weight for proportional auto-distribution
  hourPresetId: string;
}

export interface WorkflowConfig {
  stages: WorkflowStage[];
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  min_duration?: number;
  max_duration?: number;
  hour_preset?: string;
  hours_start?: number;
  hours_end?: number;
  hours_ranges?: TimeRange[];
  schedule_after?: string;
  deadline?: string;
  scheduled_date: string;
  start_minutes: number;
  done: boolean;
  workflow_config?: WorkflowConfig;
  workflow_parent_id?: string;
  workflow_stage_id?: string;
}

export interface ScheduleBlock {
  id: string;
  task_id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  duration: number;
  scheduled_date: string;
  start_minutes: number;
  hours_ranges?: TimeRange[];
  deadline?: string;
  done: boolean;
  is_split_segment: boolean;
  segment_index: number;
  segment_count: number;
}

export interface ScheduleStats {
  tasks: number;
  focusMinutes: number;
  bufferMinutes: number;
  completionRate: number;
}

export interface ScheduleWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  detail: string;
}
