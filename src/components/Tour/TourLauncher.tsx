import { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  LayoutDashboard,
  ListTodo,
  Play,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { tourModules } from './tourConfigs';
import { getTourState, isModuleCompleted, resetTourState } from './tourStore';
import { TourManager } from './TourManager';

// Map icon names from config to actual lucide components
const iconMap: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard,
  ListTodo,
  CalendarRange,
  BarChart3,
  Settings2,
};

interface TourLauncherProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal that lets the user pick which module tour to run.
 * Shows completion status for each module.
 */
export function TourLauncher({ open, onClose }: TourLauncherProps) {
  const [activeTour, setActiveTour] = useState<{ moduleId: string; steps: typeof tourModules[0]['steps'] } | null>(null);
  const [, forceUpdate] = useState(0);

  if (!open && !activeTour) return null;

  // If a tour is actively running, render TourManager instead of the launcher
  if (activeTour) {
    return (
      <TourManager
        moduleId={activeTour.moduleId}
        steps={activeTour.steps}
        onClose={() => {
          setActiveTour(null);
          forceUpdate((n) => n + 1); // refresh completion state
        }}
      />
    );
  }

  const state = getTourState();
  const allCompleted = tourModules.every((m) => state.completed.includes(m.id));

  const handleStart = (moduleId: string) => {
    const mod = tourModules.find((m) => m.id === moduleId);
    if (!mod) return;
    setActiveTour({ moduleId: mod.id, steps: mod.steps });
  };

  const handleReset = () => {
    resetTourState();
    forceUpdate((n) => n + 1);
  };

  const handleStartAll = () => {
    // Run the first incomplete module, or the first module if all complete
    const firstIncomplete = tourModules.find((m) => !isModuleCompleted(m.id));
    const target = firstIncomplete ?? tourModules[0];
    handleStart(target.id);
  };

  return (
    <div className="tour-launcher-backdrop" onClick={onClose}>
      <div className="tour-launcher" onClick={(e) => e.stopPropagation()}>
        <div className="tour-launcher__header">
          <div className="tour-launcher__title-row">
            <BookOpen size={20} />
            <h2>User Guide</h2>
          </div>
          <button type="button" className="tour-tooltip__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="tour-launcher__subtitle">
          Choose a module to learn how it works, or start from the beginning.
        </p>

        <div className="tour-launcher__modules">
          {tourModules.map((mod) => {
            const Icon = iconMap[mod.icon] ?? LayoutDashboard;
            const completed = isModuleCompleted(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                className={`tour-module-card ${completed ? 'completed' : ''}`}
                onClick={() => handleStart(mod.id)}
              >
                <div className="tour-module-card__icon">
                  <Icon size={20} />
                </div>
                <div className="tour-module-card__text">
                  <strong>{mod.label}</strong>
                  <span>{mod.description}</span>
                </div>
                <div className="tour-module-card__status">
                  {completed ? (
                    <CheckCircle2 size={16} className="tour-check" />
                  ) : (
                    <Play size={14} className="tour-play" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="tour-launcher__footer">
          {allCompleted && (
            <button type="button" className="tour-btn tour-btn--ghost" onClick={handleReset}>
              <RotateCcw size={14} />
              Reset progress
            </button>
          )}
          <button type="button" className="tour-btn tour-btn--primary" onClick={handleStartAll}>
            <Play size={14} />
            {allCompleted ? 'Replay all' : 'Start guided tour'}
          </button>
        </div>
      </div>
    </div>
  );
}
