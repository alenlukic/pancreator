"use client";

import { KICKOFF_STEPS, type KickoffStepId } from "./kickoff-types";

type KickoffStepperProps = {
  currentStepId: KickoffStepId;
  completedStepIds: KickoffStepId[];
};

export function KickoffStepper({ currentStepId, completedStepIds }: KickoffStepperProps) {
  const currentIndex = KICKOFF_STEPS.findIndex((step) => step.id === currentStepId);

  return (
    <nav
      className="kickoff-stepper"
      data-testid="kickoff-stepper"
      aria-label="Kickoff steps"
    >
      <ol className="kickoff-stepper-list">
        {KICKOFF_STEPS.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          const isComplete = completedStepIds.includes(step.id) || index < currentIndex;
          return (
            <li
              key={step.id}
              className={`kickoff-stepper-item${isCurrent ? " kickoff-stepper-item-current" : ""}${isComplete ? " kickoff-stepper-item-complete" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="kickoff-stepper-index" aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span className="kickoff-stepper-label" aria-label={step.label}>
                <span className="kickoff-stepper-label-full">{step.label}</span>
                <span className="kickoff-stepper-label-short">{step.shortLabel}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
