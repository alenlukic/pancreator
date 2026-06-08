import { CRON_PRESETS } from "@/services/automations-client";

export function AutomationWizardSchedule({
  name,
  automationId,
  schedule,
  presetId,
  nameError,
  scheduleError,
  onNameChange,
  onPresetChange,
  onScheduleChange,
}: {
  name: string;
  automationId: string;
  schedule: string;
  presetId: string;
  nameError?: string;
  scheduleError?: string;
  onNameChange: (value: string) => void;
  onPresetChange: (presetId: string, cron: string) => void;
  onScheduleChange: (value: string) => void;
}) {
  return (
    <div className="automation-wizard-step" data-testid="automation-wizard-schedule">
      <label className="automation-wizard-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          aria-invalid={nameError ? true : undefined}
        />
        {nameError ? <span className="automation-wizard-error">{nameError}</span> : null}
      </label>

      <label className="automation-wizard-field">
        <span>Automation id</span>
        <input type="text" value={automationId} readOnly aria-readonly="true" />
      </label>

      <fieldset className="automation-wizard-field">
        <legend>Schedule preset</legend>
        {CRON_PRESETS.map((preset) => (
          <label key={preset.id} className="automation-wizard-radio">
            <input
              type="radio"
              name="automation-schedule-preset"
              checked={presetId === preset.id}
              onChange={() => onPresetChange(preset.id, preset.cron)}
            />
            <span>{preset.label}</span>
          </label>
        ))}
      </fieldset>

      {presetId === "custom" ? (
        <label className="automation-wizard-field">
          <span>Custom cron</span>
          <input
            type="text"
            value={schedule}
            onChange={(event) => onScheduleChange(event.target.value)}
            aria-invalid={scheduleError ? true : undefined}
          />
          {scheduleError ? <span className="automation-wizard-error">{scheduleError}</span> : null}
        </label>
      ) : null}
    </div>
  );
}
