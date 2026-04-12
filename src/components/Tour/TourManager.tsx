import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { TourStep } from './tourConfigs';
import { markModuleCompleted, markModuleSkipped } from './tourStore';

interface TourManagerProps {
  moduleId: string;
  steps: TourStep[];
  onClose: () => void;
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Padding around the highlighted element
const HIGHLIGHT_PAD = 8;
// Gap between highlight box and tooltip
const TOOLTIP_GAP = 12;

/**
 * Full-screen overlay that walks through tour steps:
 * - Dims background via SVG mask with a cutout for the target element
 * - Positions a tooltip relative to the target
 * - Supports next/back/skip/finish
 */
export function TourManager({ moduleId, steps, onClose }: TourManagerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  // Resolve the target element and compute its bounding rect
  const computeRect = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    const box = el.getBoundingClientRect();
    setRect({
      top: box.top - HIGHLIGHT_PAD,
      left: box.left - HIGHLIGHT_PAD,
      width: box.width + HIGHLIGHT_PAD * 2,
      height: box.height + HIGHLIGHT_PAD * 2,
    });
    // Scroll element into view if needed
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [step]);

  // Recompute on step change, window resize, and scroll
  useLayoutEffect(() => {
    computeRect();
  }, [computeRect, currentStep]);

  useEffect(() => {
    const handleChange = () => computeRect();
    window.addEventListener('resize', handleChange);
    window.addEventListener('scroll', handleChange, true);
    return () => {
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('scroll', handleChange, true);
    };
  }, [computeRect]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSkip();
      } else if (e.key === 'ArrowRight' && !isLast) {
        setCurrentStep((s) => s + 1);
      } else if (e.key === 'ArrowLeft' && !isFirst) {
        setCurrentStep((s) => s - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const handleNext = () => {
    if (isLast) {
      markModuleCompleted(moduleId);
      onClose();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (!isFirst) setCurrentStep((s) => s - 1);
  };

  const handleSkip = () => {
    markModuleSkipped(moduleId);
    onClose();
  };

  // Compute tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!rect || !tooltipRef.current) {
      // Center the tooltip when no target is found
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const tt = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = 0;
    let left = 0;

    switch (step.placement) {
      case 'bottom':
        top = rect.top + rect.height + TOOLTIP_GAP;
        left = rect.left + rect.width / 2 - tt.width / 2;
        break;
      case 'top':
        top = rect.top - tt.height - TOOLTIP_GAP;
        left = rect.left + rect.width / 2 - tt.width / 2;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tt.height / 2;
        left = rect.left + rect.width + TOOLTIP_GAP;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tt.height / 2;
        left = rect.left - tt.width - TOOLTIP_GAP;
        break;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, vw - tt.width - 12));
    top = Math.max(12, Math.min(top, vh - tt.height - 12));

    return { top, left };
  };

  if (!step) return null;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* SVG overlay with cutout */}
      <svg className="tour-overlay__mask" onClick={handleSkip}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(11, 24, 41, 0.55)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Highlight ring around target */}
      {rect && (
        <div
          className="tour-highlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tour-tooltip"
        style={getTooltipStyle()}
      >
        <div className="tour-tooltip__header">
          <span className="tour-tooltip__progress">
            {currentStep + 1} of {steps.length}
          </span>
          <button
            type="button"
            className="tour-tooltip__close"
            onClick={handleSkip}
            aria-label="Close tour"
          >
            <X size={14} />
          </button>
        </div>

        <h3 className="tour-tooltip__title">{step.title}</h3>
        <p className="tour-tooltip__body">{step.body}</p>

        {step.actionHint && (
          <span className="tour-tooltip__hint">{step.actionHint}</span>
        )}

        <div className="tour-tooltip__actions">
          {!isFirst && (
            <button type="button" className="tour-btn tour-btn--ghost" onClick={handleBack}>
              <ChevronLeft size={14} />
              Back
            </button>
          )}
          <div className="tour-tooltip__dots">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`tour-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`}
              />
            ))}
          </div>
          <button type="button" className="tour-btn tour-btn--primary" onClick={handleNext}>
            {isLast ? 'Finish' : 'Next'}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
