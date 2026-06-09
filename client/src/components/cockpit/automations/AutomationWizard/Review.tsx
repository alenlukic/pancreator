import { humanScheduleLabel, previewNextRunLabel } from "@/services/automations-client";

export function AutomationWizardReview({
  name,
  automationId,
  enabled,
  schedule,
  persona,
  prompt,
  maxConcurrent,
  timeoutMinutes,
  saveError,
  saving,
}: {
  name: string;
  automationId: string;
  enabled: boolean;
  schedule: string;
  persona: string;
  prompt: string;
  maxConcurrent: number;
  timeoutMinutes: number;
  saveError?: string;
  saving: boolean;
}) {
  const promptExcerpt =
    prompt.length > 120 ? `${prompt.slice(0, 120)}…` : prompt;

  return (
    <div className="automation-wizard-step" data-testid="automation-wizard-review">
      <dl className="automation-wizard-review-summary">
        <div>
          <dt>Name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Id</dt>
          <dd>{automationId}</dd>
        </div>
        <div>
          <dt>Enabled</dt>
          <dd>{enabled ? "true" : "false"}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>{humanScheduleLabel(schedule)}</dd>
        </div>
        <div>
          <dt>Preview next run</dt>
          <dd data-testid="automation-wizard-preview-next-run">
            {previewNextRunLabel(schedule)}
          </dd>
        </div>
        <div>
          <dt>Persona</dt>
          <dd>{persona}</dd>
        </div>
        <div>
          <dt>Prompt</dt>
          <dd>{promptExcerpt}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>
            maxConcurrent={maxConcurrent}, timeoutMinutes={timeoutMinutes}
          </dd>
        </div>
      </dl>
      {saveError ? <p className="automation-wizard-error">{saveError}</p> : null}
      {saving ? <p className="cockpit-muted cockpit-loading">Saving…</p> : null}
    </div>
  );
}
