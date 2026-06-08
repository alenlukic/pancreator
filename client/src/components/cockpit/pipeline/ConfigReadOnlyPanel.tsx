"use client";

import type { RuntimeConfigSnapshot } from "@/services/config";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { LoadingState } from "../shared/LoadingState";

export function ConfigReadOnlyPanel({
  config,
  loading,
  error,
  onRetry,
}: {
  config: RuntimeConfigSnapshot | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="config-readonly-panel" data-testid="config-readonly-panel" aria-readonly="true">
      <h2>Runtime configuration</h2>
      {loading ? <LoadingState label="Loading configuration…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      {!loading && !error && config === null ? (
        <EmptyState>
          <p>No configuration available.</p>
        </EmptyState>
      ) : null}
      {!loading && !error && config !== null ? (
        <dl className="config-readonly-fields">
          <div>
            <dt>Invocation mode</dt>
            <dd data-testid="config-invocation-mode">{config.invocationMode}</dd>
          </div>
          <div>
            <dt>design_steps default</dt>
            <dd data-testid="config-design-steps">{config.designStepsDefault ? "true" : "false"}</dd>
          </div>
          <div>
            <dt>stage_remediation</dt>
            <dd data-testid="config-stage-remediation">{config.stageRemediation ? "true" : "false"}</dd>
          </div>
          <div>
            <dt>SDK sampling</dt>
            <dd data-testid="config-sdk-sampling">
              {config.sdkSampling.enabled
                ? `${config.sdkSampling.ratePercent ?? 0}% · ${config.sdkSampling.scope ?? "unspecified"}`
                : "disabled"}
            </dd>
          </div>
          <div>
            <dt>Active escalation config</dt>
            <dd data-testid="config-active-escalation">{config.activeEscalationConfig}</dd>
          </div>
          <div>
            <dt>Persona escalation tiers</dt>
            <dd>
              <ul className="config-escalation-badges" data-testid="config-escalation-badges">
                {config.personaEscalationBadges.map((badge) => (
                  <li key={badge.persona}>
                    <span className="config-badge-persona">{badge.persona}</span>
                    <span className="config-badge-tier">{badge.tierLabel}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
