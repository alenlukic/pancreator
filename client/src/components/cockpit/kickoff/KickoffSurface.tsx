"use client";

import { useEffect } from "react";
import { KickoffStepFooter } from "./KickoffStepFooter";
import { KickoffStepModels } from "./KickoffStepModels";
import { KickoffStepPreview } from "./KickoffStepPreview";
import { KickoffStepReview } from "./KickoffStepReview";
import { KickoffStepSource } from "./KickoffStepSource";
import { KickoffStepper } from "./KickoffStepper";
import { KICKOFF_STEPS } from "./kickoff-types";
import { useKickoffFlow } from "./useKickoffFlow";

async function loadInboxDirective(path: string): Promise<string> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error("Failed to load inbox directive");
  }
  const payload = (await response.json()) as { content?: string };
  return payload.content ?? "";
}

export function KickoffSurface() {
  const flow = useKickoffFlow();
  const {
    state,
    currentStep,
    canContinue,
    continueDisabledReason,
    goBack,
    goForward,
    setDirectiveMarkdown,
    setError,
    setLoading,
  } = flow;

  useEffect(() => {
    if (state.source?.kind !== "inbox" || state.source.inboxPath === undefined) {
      return;
    }
    if (state.directiveMarkdown.length > 0) {
      return;
    }
    let cancelled = false;
    setLoading(true, "Loading inbox directive…");
    void (async () => {
      try {
        const markdown = await loadInboxDirective(state.source!.inboxPath!);
        if (!cancelled) {
          setDirectiveMarkdown(markdown);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Failed to load inbox directive");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setDirectiveMarkdown, setError, setLoading, state.directiveMarkdown.length, state.source]);

  const completedStepIds = KICKOFF_STEPS.slice(0, state.stepIndex).map((step) => step.id);
  const isReview = currentStep.id === "review";

  return (
    <div className="kickoff-surface" data-testid="kickoff-surface">
      <header className="kickoff-surface-header">
        <h1 className="kickoff-page-title">Work Intake / Kickoff</h1>
        <p className="kickoff-page-subtitle">Start feature delivery from the Cockpit.</p>
      </header>

      <KickoffStepper currentStepId={currentStep.id} completedStepIds={completedStepIds} />

      {currentStep.id === "source" ? <KickoffStepSource flow={flow} /> : null}
      {currentStep.id === "preview" ? <KickoffStepPreview flow={flow} /> : null}
      {currentStep.id === "models" ? <KickoffStepModels flow={flow} /> : null}
      {currentStep.id === "review" ? <KickoffStepReview flow={flow} /> : null}

      {!isReview || state.launchResult === null ? (
        <KickoffStepFooter
          showBack={state.stepIndex > 0}
          onBack={goBack}
          onContinue={goForward}
          continueDisabled={!canContinue || state.stepIndex >= KICKOFF_STEPS.length - 1}
          continueDisabledReason={continueDisabledReason}
          primaryAction={
            isReview ? undefined : (
              <button
                type="button"
                className="kickoff-btn-primary"
                onClick={goForward}
                disabled={!canContinue || state.stepIndex >= KICKOFF_STEPS.length - 1}
                aria-describedby={!canContinue ? "kickoff-continue-reason" : undefined}
              >
                Continue
              </button>
            )
          }
        />
      ) : null}
    </div>
  );
}
