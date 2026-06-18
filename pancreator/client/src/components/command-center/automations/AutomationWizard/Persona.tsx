import { EmptyState } from "../../shared/EmptyState";

export function AutomationWizardPersona({
  persona,
  personas,
  personaError,
  onPersonaChange,
}: {
  persona: string;
  personas: string[];
  personaError?: string;
  onPersonaChange: (value: string) => void;
}) {
  if (personas.length === 0) {
    return (
      <div className="automation-wizard-step" data-testid="automation-wizard-persona">
        <EmptyState>
          <p>Add persona files under lib/personas/ to populate this dropdown.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="automation-wizard-step" data-testid="automation-wizard-persona">
      <label className="automation-wizard-field">
        <span>Persona</span>
        <select
          value={persona}
          onChange={(event) => onPersonaChange(event.target.value)}
          aria-invalid={personaError ? true : undefined}
        >
          <option value="">Select a persona</option>
          {personas.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
        {personaError ? <span className="automation-wizard-error">{personaError}</span> : null}
      </label>
    </div>
  );
}
