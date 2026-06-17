"use client";

type KickoffStepFooterProps = {
  showBack: boolean;
  onBack?: () => void;
  continueLabel?: string;
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueDisabledReason?: string;
  secondaryAction?: React.ReactNode;
  primaryAction?: React.ReactNode;
};

export function KickoffStepFooter({
  showBack,
  onBack,
  continueLabel = "Continue",
  onContinue,
  continueDisabled = false,
  continueDisabledReason = "",
  secondaryAction,
  primaryAction,
}: KickoffStepFooterProps) {
  return (
    <div className="kickoff-step-footer">
      <div className="kickoff-step-footer-left">
        {showBack ? (
          <button type="button" className="kickoff-btn-secondary" onClick={onBack}>
            Go back
          </button>
        ) : null}
        {secondaryAction}
      </div>
      <div className="kickoff-step-footer-right">
        {primaryAction ?? (
          <button
            type="button"
            className="kickoff-btn-primary"
            onClick={onContinue}
            disabled={continueDisabled}
            aria-describedby={continueDisabled ? "kickoff-continue-reason" : undefined}
          >
            {continueLabel}
          </button>
        )}
        {continueDisabled && continueDisabledReason.length > 0 ? (
          <span id="kickoff-continue-reason" className="kickoff-sr-only">
            {continueDisabledReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}
