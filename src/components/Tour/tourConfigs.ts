// Tour step definitions for each app module.
// Each step targets a CSS selector and provides instructional copy.

export interface TourStep {
  /** CSS selector for the element to highlight */
  target: string;
  /** Short heading for the tooltip */
  title: string;
  /** Instructional body text */
  body: string;
  /** Preferred tooltip placement relative to the target */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action hint shown as a subtle badge */
  actionHint?: string;
  /** Optional: if true, the step works even without a target (freestanding) */
  freestanding?: boolean;
}

export interface TourModule {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  steps: TourStep[];
}

// ── Dashboard / Overview ────────────────────────────────────────────────────

const dashboardSteps: TourStep[] = [
  {
    target: '.brand',
    title: 'Welcome to goodcalendar',
    body: 'This is your personal planning workspace. Let\'s walk through the key areas so you can get the most out of it.',
    placement: 'right',
  },
  {
    target: '.sidebar-nav',
    title: 'Navigation',
    body: 'Switch between views using the sidebar. Planner gives you a weekly calendar, and Priorities shows tasks ranked by urgency.',
    placement: 'right',
    actionHint: 'Click any item to navigate',
  },
  {
    target: '.workspace-header',
    title: 'Header Controls',
    body: 'Quick actions live here — toggle panels, auto-schedule tasks, jump to today, or create a new task.',
    placement: 'bottom',
  },
  {
    target: '.focus-strip',
    title: 'Weekly Capacity',
    body: 'This bar shows how your week breaks down: focus time, tasks, buffers, and free time. It updates as you add or complete tasks.',
    placement: 'bottom',
    actionHint: 'Hover segments for details',
  },
  {
    target: '.week-board__header',
    title: 'Week Navigation',
    body: 'Click any day to focus on it. Use the arrows above to move between weeks.',
    placement: 'bottom',
    actionHint: 'Click a day to select it',
  },
];

// ── Tasks ───────────────────────────────────────────────────────────────────

const tasksSteps: TourStep[] = [
  {
    target: '.primary-btn',
    title: 'Create a Task',
    body: 'Click "New Task" to open the task composer. You can set the title, type, priority, duration, and scheduling preferences.',
    placement: 'bottom',
    actionHint: 'Click to create',
  },
  {
    target: '.week-board',
    title: 'Your Schedule',
    body: 'Tasks appear as blocks on the weekly board. Drag them to reschedule, or click to edit details.',
    placement: 'top',
    actionHint: 'Drag blocks to move them',
  },
  {
    target: '.rail-panel',
    title: 'Task Rail',
    body: 'The side rail shows your task backlog and priority queue. Drag tasks from here onto the calendar to schedule them.',
    placement: 'left',
    actionHint: 'Drag tasks to the calendar',
  },
  {
    target: '.header-actions .ghost-btn',
    title: 'Auto-Schedule',
    body: '"Find a time" automatically places unscheduled tasks into available slots based on your preferences and priorities.',
    placement: 'bottom',
    actionHint: 'Click to auto-place',
  },
];

// ── Calendar ────────────────────────────────────────────────────────────────

const calendarSteps: TourStep[] = [
  {
    target: '.planner-surface',
    title: 'Planner View',
    body: 'This is your main scheduling surface. It shows a full week with time blocks for each day.',
    placement: 'top',
  },
  {
    target: '.week-board__body',
    title: 'Time Grid',
    body: 'Click and drag on empty space to draw a new time block directly on the calendar. The grid snaps to 15-minute intervals.',
    placement: 'top',
    actionHint: 'Click + drag to draw',
  },
  {
    target: '.timezone-chip',
    title: 'Timezone',
    body: 'Your current timezone is shown here. All times on the board are displayed in this timezone.',
    placement: 'bottom',
  },
  {
    target: '.planner-surface__header',
    title: 'Month & Week Controls',
    body: 'Navigate between weeks using the arrow buttons. The current month and sync status are shown here.',
    placement: 'bottom',
    actionHint: 'Use arrows to navigate',
  },
];

// ── Analytics / Priorities ──────────────────────────────────────────────────

const analyticsSteps: TourStep[] = [
  {
    target: '.nav-item[class*="priorities"], .sidebar-nav button:nth-child(2)',
    title: 'Priorities View',
    body: 'Switch to Priorities to see all your tasks organized by urgency level — critical, high, medium, and low.',
    placement: 'right',
    actionHint: 'Click to switch view',
  },
  {
    target: '.focus-strip',
    title: 'Time Distribution',
    body: 'The capacity bar doubles as an analytics summary — see at a glance how your week is allocated across different work types.',
    placement: 'bottom',
  },
  {
    target: '.stat-card, .focus-strip__legend',
    title: 'Key Metrics',
    body: 'Track focus hours, task completion rate, and buffer utilization. These update in real-time as you work through your schedule.',
    placement: 'bottom',
  },
];

// ── Settings ────────────────────────────────────────────────────────────────

const settingsSteps: TourStep[] = [
  {
    target: '.nav-group',
    title: 'Configuration',
    body: 'Expand these sections to access settings for time blocking, meetings, and calendar sync.',
    placement: 'right',
    actionHint: 'Click to expand',
  },
  {
    target: '.nav-child-btn, .nav-child',
    title: 'Buffer Settings',
    body: 'Click "Buffers" to configure padding between events, travel time, and breaks. These protect your focus time.',
    placement: 'right',
    actionHint: 'Click Buffers to configure',
  },
  {
    target: '.icon-btn[aria-label*="sidebar"]',
    title: 'Toggle Sidebar',
    body: 'Collapse the sidebar for a wider workspace. You can always bring it back with this button.',
    placement: 'bottom',
    actionHint: 'Click to toggle',
  },
];

// ── All modules ─────────────────────────────────────────────────────────────

export const tourModules: TourModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Learn the main layout and navigation',
    icon: 'LayoutDashboard',
    steps: dashboardSteps,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Create, schedule, and manage tasks',
    icon: 'ListTodo',
    steps: tasksSteps,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Navigate and interact with the planner',
    icon: 'CalendarRange',
    steps: calendarSteps,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Understand your priorities and metrics',
    icon: 'BarChart3',
    steps: analyticsSteps,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Configure your workspace preferences',
    icon: 'Settings2',
    steps: settingsSteps,
  },
];
