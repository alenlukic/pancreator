"use client";

import { useCallback } from "react";
import type { KickoffFlowApi } from "./useKickoffFlow";

type KickoffStepPreviewProps = {
  flow: KickoffFlowApi;
};

export function KickoffStepPreview({ flow }: KickoffStepPreviewProps) {
  const {
    state,
    setDirectiveMarkdown,
    setLoading,
    setError,
    setSaveSuccessPath,
  } = flow;

  const handleSave = useCallback(async () => {
    setLoading(true, "Saving inbox directive…");
    setError(null);
    try {
      const response = await fetch("/api/kickoff/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: state.directiveMarkdown }),
      });
      const payload = (await response.json()) as { path?: string; error?: string };
      if (!response.ok || payload.path === undefined) {
        throw new Error(payload.error ?? "Save failed");
      }
      setSaveSuccessPath(payload.path);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading, setSaveSuccessPath, state.directiveMarkdown]);

  async function copySavedPath() {
    if (state.saveSuccessPath !== null) {
      await navigator.clipboard.writeText(state.saveSuccessPath);
    }
  }

  return (
    <section
      className="kickoff-step-panel"
      data-testid="kickoff-step-preview"
      aria-busy={state.loading || undefined}
    >
      <h2 className="kickoff-step-title">Preview directive</h2>
      <p className="kickoff-step-helper">Edit the markdown body before configuring models and launch.</p>

      {state.error ? (
        <div className="kickoff-error-banner" role="alert">
          <p>{state.error}</p>
          <button type="button" className="kickoff-btn-secondary" onClick={() => void handleSave()}>
            Retry save
          </button>
        </div>
      ) : null}

      <label className="kickoff-field-label" htmlFor="kickoff-directive-editor">
        Directive markdown
      </label>
      <textarea
        id="kickoff-directive-editor"
        className="kickoff-directive-editor"
        value={state.directiveMarkdown}
        onChange={(event) => setDirectiveMarkdown(event.target.value)}
      />

      <div className="kickoff-preview-actions">
        <button
          type="button"
          className="kickoff-btn-secondary"
          onClick={() => void handleSave()}
          disabled={state.loading || state.directiveMarkdown.trim().length === 0}
        >
          Save inbox directive
        </button>
      </div>

      {state.saveSuccessPath !== null ? (
        <div className="kickoff-toast" role="status" data-testid="kickoff-save-toast">
          <span>Inbox directive saved</span>
          <button type="button" className="kickoff-btn-secondary" onClick={() => void copySavedPath()}>
            Copy inbox path
          </button>
        </div>
      ) : null}
    </section>
  );
}
