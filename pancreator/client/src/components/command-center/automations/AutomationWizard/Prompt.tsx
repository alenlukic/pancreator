export function AutomationWizardPrompt({
  prompt,
  promptError,
  onPromptChange,
}: {
  prompt: string;
  promptError?: string;
  onPromptChange: (value: string) => void;
}) {
  return (
    <div className="automation-wizard-step" data-testid="automation-wizard-prompt">
      <label className="automation-wizard-field">
        <span>Prompt</span>
        <textarea
          className="automation-prompt-editor"
          rows={6}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          aria-invalid={promptError ? true : undefined}
        />
        {promptError ? <span className="automation-wizard-error">{promptError}</span> : null}
      </label>
    </div>
  );
}
