export type TaskType = 'task' | 'focus' | 'buffer';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type WarningSeverity = 'critical' | 'warning' | 'notice';
export type WorkflowAllocationMode = 'auto' | 'manual';

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

export type DurationUnit = 'm' | 'h' | 'd' | 'w' | 'mo';

export interface WorkflowStage {
  id: string;
  name: string;
  enabled: boolean;
  minutes: number;     // auto-suggested (proportional), user-editable; in minutes
  weight: number;      // relative weight for proportional auto-distribution
  hourPresetId: string;
  durationUnit?: DurationUnit; // display preference for duration input
}

export interface WorkflowConfig {
  stages: WorkflowStage[];
  allocation_mode?: WorkflowAllocationMode;
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
  earliest_start_at?: string;
  schedule_after?: string;
  due_at?: string;
  deadline?: string;
  scheduled_date: string;
  start_minutes: number;
  done: boolean;
  done_at?: string;       // ISO timestamp when marked done
  deleted_at?: string;    // ISO timestamp for soft delete (null = active)
  is_pinned?: boolean;
  workflow_config?: WorkflowConfig;
  workflow_parent_id?: string;
  workflow_stage_id?: string;
  external_id?: string; // ID of the event in Google/Outlook
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

export type CalendarProvider = 'google' | 'outlook';

export interface ExternalCalendar {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  calendar_id: string;
  calendar_name: string;
  calendar_description?: string;
  color?: string;
  primary_calendar: boolean;
  sync_enabled: boolean;
  last_sync_at?: string;
  sync_token?: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalEvent {
  id: string;
  user_id: string;
  external_calendar_id: string;
  external_event_id: string;
  title: string;
  description?: string;
  location?: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurring: boolean;
  recurrence_rule?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  attendees?: any[];
  last_modified: string;
  created_at: string;
  updated_at: string;
}
