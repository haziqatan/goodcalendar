// Persistence layer for tour completion state.
// Uses localStorage so progress survives page reloads.

const STORAGE_KEY = 'goodcalendar-tour-state';

export interface TourState {
  /** Module IDs the user has completed */
  completed: string[];
  /** Module IDs the user has explicitly skipped */
  skipped: string[];
  /** Whether the user has seen the initial welcome prompt */
  welcomeSeen: boolean;
}

const DEFAULT_STATE: TourState = {
  completed: [],
  skipped: [],
  welcomeSeen: false,
};

function load(): TourState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function save(state: TourState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getTourState(): TourState {
  return load();
}

export function markModuleCompleted(moduleId: string): void {
  const state = load();
  if (!state.completed.includes(moduleId)) {
    state.completed.push(moduleId);
  }
  // Remove from skipped if it was there
  state.skipped = state.skipped.filter((id) => id !== moduleId);
  save(state);
}

export function markModuleSkipped(moduleId: string): void {
  const state = load();
  if (!state.skipped.includes(moduleId)) {
    state.skipped.push(moduleId);
  }
  save(state);
}

export function markWelcomeSeen(): void {
  const state = load();
  state.welcomeSeen = true;
  save(state);
}

export function isModuleCompleted(moduleId: string): boolean {
  return load().completed.includes(moduleId);
}

export function resetTourState(): void {
  save({ ...DEFAULT_STATE });
}
