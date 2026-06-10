"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import { StatusPill } from "@/components/command-center/shared/StatusPill";
import { getPresetById } from "./kickoff-model-presets";
import type { KickoffFlowApi } from "./useKickoffFlow";

type KickoffStepReviewProps = {
  flow: KickoffFlowApi;
};

export function KickoffStepReview({ flow }: KickoffStepReviewProps) {
  const {
    state,
    sourceLabel,
    launchInboxPath,
    setLoading,
    setError,
    setSaveSuccessPath,
    setLaunchResult,
    setLaunchError,
  } = flow;
  const [directiveExpanded, setDirectiveExpanded] = useState(false);
  const preset = getPresetById(state.presetId);
  const excerpt = state.directiveMarkdown.replace(/\s+/gu, " ").trim().slice(0, 120);

  const handleSave = useCallback(async () => {
    setLoading(true, "Saving inbox directive…");
    setError(null);
    try {
      const response = await fetch("/api/kickoff/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ markdown: state.directiveMarkdown }),
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

  const handleLaunch = useCallback(async () => {
    setLoading(true, "Launching feature delivery…");
    setLaunchError(null);
    setError(null);
    try {
      let inboxPath = launchInboxPath;
      if (inboxPath === null) {
        const saveResponse = await fetch("/api/kickoff/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stringifyCompactJson({ markdown: state.directiveMarkdown }),
        });
        const savePayload = (await saveResponse.json()) as { path?: string; error?: string };
        if (!saveResponse.ok || savePayload.path === undefined) {
          throw new Error(savePayload.error ?? "Save before launch failed");
        }
        inboxPath = savePayload.path;
        setSaveSuccessPath(savePayload.path);
      }

      const response = await fetch("/api/kickoff/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ inboxPath }),
      });
      const payload = (await response.json()) as {
        taskId?: string;
        featureId?: string;
        runDir?: string;
        handoffFile?: string;
        error?: string;
      };
      if (
        !response.ok ||
        payload.taskId === undefined ||
        payload.featureId === undefined ||
        payload.runDir === undefined ||
        payload.handoffFile === undefined
      ) {
        throw new Error(payload.error ?? "Launch failed");
      }
      setLaunchResult({
        taskId: payload.taskId,
        featureId: payload.featureId,
        runDir: payload.runDir,
        handoffFile: payload.handoffFile,
      });
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Launch failed");
    } finally {
      setLoading(false);
    }
  }, [launchInboxPath, setError, setLaunchError, setLaunchResult, setLoading, setSaveSuccessPath, state.directiveMarkdown]);

  const launchDisabled = state.loading || state.directiveMarkdown.trim().length === 0;

  return (
    <section
      className="kickoff-step-panel"
      data-testid="kickoff-step-review"
      aria-busy={state.loading || undefined}
    >
      <h2 className="kickoff-step-title">Review and launch</h2>

      <div className="kickoff-review-summary">
        <section>
          <h3>Work source</h3>
          <p>{sourceLabel}</p>
        </section>
        <section>
          <h3>Directive excerpt</h3>
          <p>{excerpt}{state.directiveMarkdown.length > 120 ? "…" : ""}</p>
          <button
            type="button"
            className="kickoff-disclosure-trigger"
            aria-expanded={directiveExpanded}
            onClick={() => setDirectiveExpanded((open) => !open)}
          >
            {directiveExpanded ? "Collapse directive preview" : "Expand directive preview"}
          </button>
          {directiveExpanded ? (
            <pre className="kickoff-review-directive">{state.directiveMarkdown}</pre>
          ) : null}
        </section>
        <section>
          <h3>Model preset</h3>
          <p>{preset.label}</p>
          {state.personaOverrides.length > 0 ? (
            <ul className="kickoff-override-chips">
              {state.personaOverrides.map((entry) => (
                <li key={entry.persona}>
                  {entry.persona}: {entry.model}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {state.launchError ? (
        <div className="kickoff-error-banner" role="alert">
          <p>{state.launchError}</p>
          <button type="button" className="kickoff-btn-secondary" onClick={() => void handleLaunch()}>
            Retry launch
          </button>
        </div>
      ) : null}

      {state.launchResult ? (
        <div className="kickoff-success-panel" data-testid="kickoff-launch-success">
          <h3>{state.launchResult.featureId}</h3>
          <StatusPill status="Running" />
          <Link href="/mission-control" className="kickoff-btn-primary kickoff-link-btn">
            Open mission control
          </Link>
        </div>
      ) : (
        <div className="kickoff-review-actions">
          <button
            type="button"
            className="kickoff-btn-secondary"
            onClick={() => void handleSave()}
            disabled={state.loading}
          >
            Save inbox directive
          </button>
          <button
            type="button"
            className="kickoff-btn-primary"
            onClick={() => void handleLaunch()}
            disabled={launchDisabled}
            aria-describedby={launchDisabled ? "kickoff-launch-reason" : undefined}
          >
            {state.loading ? "Launching feature delivery…" : "Launch feature delivery"}
          </button>
          {launchDisabled ? (
            <span id="kickoff-launch-reason" className="kickoff-sr-only">
              Save the directive or select an inbox item before launch.
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
