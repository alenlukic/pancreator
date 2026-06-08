"use client";

import { useMemo, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import {
  CRON_PRESETS,
  defaultAgentAutomationDraft,
  deriveAutomationId,
  isValidCronExpression,
  type AutomationRecord,
} from "@/services/automations-client";
import { AutomationWizardPersona } from "./Persona";
import { AutomationWizardPrompt } from "./Prompt";
import { AutomationWizardReview } from "./Review";
import { AutomationWizardSchedule } from "./Schedule";

const WIZARD_STEPS = ["Schedule", "Persona", "Prompt", "Review"] as const;

function presetIdForSchedule(schedule: string): string {
  const match = CRON_PRESETS.find((preset) => preset.cron === schedule && preset.id !== "custom");
  return match?.id ?? "custom";
}

export function AutomationWizardShell({
  mode,
  initialRecord,
  personas,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initialRecord?: AutomationRecord;
  personas: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<AutomationRecord>(
    initialRecord ?? defaultAgentAutomationDraft(),
  );
  const [presetId, setPresetId] = useState(() => presetIdForSchedule(draft.schedule));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const step = WIZARD_STEPS[stepIndex] ?? "Schedule";

  const agentTrigger = useMemo(() => {
    if (draft.trigger.kind !== "agent") {
      return { kind: "agent" as const, persona: "", prompt: "" };
    }
    return draft.trigger;
  }, [draft.trigger]);

  function updateDraft(partial: Partial<AutomationRecord>): void {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function validateScheduleStep(): boolean {
    const errors: Record<string, string> = {};
    if (draft.name.trim() === "") {
      errors.name = "Name is required.";
    }
    if (deriveAutomationId(draft.name) === "") {
      errors.name = "Name must produce a valid automation id.";
    }
    if (!isValidCronExpression(draft.schedule)) {
      errors.schedule = "Schedule must be a valid 5-field cron expression.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validatePersonaStep(): boolean {
    const errors: Record<string, string> = {};
    if (agentTrigger.persona.trim() === "") {
      errors.persona = "Persona is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validatePromptStep(): boolean {
    const errors: Record<string, string> = {};
    if (agentTrigger.prompt.trim() === "") {
      errors.prompt = "Prompt is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    const payload: AutomationRecord = {
      ...draft,
      id: mode === "create" ? deriveAutomationId(draft.name) : draft.id,
      trigger: {
        kind: "agent",
        persona: agentTrigger.persona,
        prompt: agentTrigger.prompt,
      },
    };

    const response = await fetch("/api/automations", {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson(payload),
    });

    if (!response.ok) {
      const data = (await response.json()) as { errors?: string[] };
      setSaveError(data.errors?.join(" ") ?? "Unable to save automation.");
      setSaving(false);
      return;
    }

    await onSaved();
    onClose();
    setSaving(false);
  }

  function handleNext(): void {
    if (step === "Schedule" && !validateScheduleStep()) {
      return;
    }
    if (step === "Persona" && !validatePersonaStep()) {
      return;
    }
    if (step === "Prompt" && !validatePromptStep()) {
      return;
    }
    setFieldErrors({});
    setStepIndex((current) => Math.min(current + 1, WIZARD_STEPS.length - 1));
  }

  function handleBack(): void {
    setFieldErrors({});
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  return (
    <section className="automation-wizard" data-testid="automation-wizard">
      <header className="automation-wizard-stepper" aria-label="Automation wizard steps">
        {WIZARD_STEPS.map((label, index) => {
          const isActive = index === stepIndex;
          const isComplete = index < stepIndex;
          return (
            <span
              key={label}
              className={`automation-wizard-step-indicator${isActive ? " automation-wizard-step-active" : ""}${isComplete ? " automation-wizard-step-complete" : ""}`}
              aria-current={isActive ? "step" : undefined}
            >
              {isComplete ? "✓ " : null}
              {label}
            </span>
          );
        })}
      </header>

      {step === "Schedule" ? (
        <AutomationWizardSchedule
          name={draft.name}
          automationId={mode === "create" ? deriveAutomationId(draft.name) : draft.id}
          schedule={draft.schedule}
          presetId={presetId}
          nameError={fieldErrors.name}
          scheduleError={fieldErrors.schedule}
          onNameChange={(value) => {
            updateDraft({
              name: value,
              id: mode === "create" ? deriveAutomationId(value) : draft.id,
            });
          }}
          onPresetChange={(nextPresetId, cron) => {
            setPresetId(nextPresetId);
            if (nextPresetId !== "custom") {
              updateDraft({ schedule: cron });
            }
          }}
          onScheduleChange={(value) => updateDraft({ schedule: value })}
        />
      ) : null}

      {step === "Persona" ? (
        <AutomationWizardPersona
          persona={agentTrigger.persona}
          personas={personas}
          personaError={fieldErrors.persona}
          onPersonaChange={(value) =>
            updateDraft({
              trigger: { kind: "agent", persona: value, prompt: agentTrigger.prompt },
            })
          }
        />
      ) : null}

      {step === "Prompt" ? (
        <AutomationWizardPrompt
          prompt={agentTrigger.prompt}
          promptError={fieldErrors.prompt}
          onPromptChange={(value) =>
            updateDraft({
              trigger: { kind: "agent", persona: agentTrigger.persona, prompt: value },
            })
          }
        />
      ) : null}

      {step === "Review" ? (
        <AutomationWizardReview
          name={draft.name}
          automationId={mode === "create" ? deriveAutomationId(draft.name) : draft.id}
          enabled={draft.enabled}
          schedule={draft.schedule}
          persona={agentTrigger.persona}
          prompt={agentTrigger.prompt}
          maxConcurrent={draft.policy.maxConcurrent}
          timeoutMinutes={draft.policy.timeoutMinutes}
          saveError={saveError ?? undefined}
          saving={saving}
        />
      ) : null}

      <footer className="automation-wizard-footer">
        <button type="button" className="cockpit-action-button" onClick={onClose}>
          Cancel
        </button>
        {stepIndex > 0 ? (
          <button type="button" className="cockpit-action-button" onClick={handleBack}>
            Back
          </button>
        ) : null}
        {step !== "Review" ? (
          <button type="button" className="cockpit-action-button" onClick={handleNext}>
            Next
          </button>
        ) : (
          <button
            type="button"
            className="cockpit-action-button"
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="automation-wizard-save"
          >
            Save
          </button>
        )}
      </footer>
    </section>
  );
}
