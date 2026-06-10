"use client";

import { useState } from "react";
import {
  getPresetById,
  KICKOFF_MODEL_PRESETS,
  KICKOFF_PERSONA_OPTIONS,
} from "./kickoff-model-presets";
import type { KickoffFlowApi } from "./useKickoffFlow";
import type { KickoffModelPresetId } from "./kickoff-types";

type KickoffStepModelsProps = {
  flow: KickoffFlowApi;
};

export function KickoffStepModels({ flow }: KickoffStepModelsProps) {
  const { state, setPresetId, setPersonaOverrides } = flow;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedPreset = getPresetById(state.presetId);

  function handleOverrideChange(persona: string, model: string) {
    const next = state.personaOverrides.filter((entry) => entry.persona !== persona);
    if (model.trim().length > 0) {
      next.push({ persona, model: model.trim() });
    }
    setPersonaOverrides(next);
  }

  function overrideFor(persona: string): string {
    return state.personaOverrides.find((entry) => entry.persona === persona)?.model ?? "";
  }

  return (
    <section className="kickoff-step-panel" data-testid="kickoff-step-models">
      <h2 className="kickoff-step-title">Configure models</h2>
      <p className="kickoff-step-helper">Pick a preset. Persona markdown files are not modified.</p>

      <div className="kickoff-preset-grid" role="list">
        {KICKOFF_MODEL_PRESETS.map((preset) => {
          const selected = state.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="listitem"
              className={`kickoff-preset-card${selected ? " kickoff-preset-card-selected" : ""}`}
              onClick={() => setPresetId(preset.id as KickoffModelPresetId)}
              aria-pressed={selected}
            >
              <span className="kickoff-preset-label">{preset.label}</span>
              <span className="kickoff-preset-summary">{preset.summary}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="kickoff-disclosure-trigger"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        {advancedOpen ? "Hide advanced model settings" : "Show advanced model settings"}
      </button>

      {advancedOpen ? (
        <div className="kickoff-advanced-panel">
          {KICKOFF_PERSONA_OPTIONS.map((persona) => (
            <label key={persona} className="kickoff-advanced-row">
              <span>{persona}</span>
              <input
                type="text"
                className="kickoff-text-input"
                placeholder={selectedPreset.models[persona] ?? "model id"}
                value={overrideFor(persona)}
                onChange={(event) => handleOverrideChange(persona, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
