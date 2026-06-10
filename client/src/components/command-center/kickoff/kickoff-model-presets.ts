import type { KickoffModelPresetId } from "./kickoff-types";

export type KickoffModelPreset = {
  id: KickoffModelPresetId;
  label: string;
  summary: string;
  models: Record<string, string>;
};

export const KICKOFF_MODEL_PRESETS: KickoffModelPreset[] = [
  {
    id: "cheap-fast",
    label: "Cheap / fast",
    summary: "Lower-cost models for quick iteration.",
    models: {
      "tech-lead": "composer-2.5-fast",
      coder: "composer-2.5-fast",
      reviewer: "composer-2.5-fast",
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    summary: "Default mix of speed and quality across personas.",
    models: {
      "tech-lead": "composer-2.5",
      coder: "composer-2.5",
      reviewer: "composer-2.5",
    },
  },
  {
    id: "high-quality",
    label: "High quality",
    summary: "Higher-quality models for complex features.",
    models: {
      "tech-lead": "composer-2.5",
      coder: "composer-2.5",
      reviewer: "composer-2.5",
    },
  },
];

export const DEFAULT_PRESET_ID: KickoffModelPresetId = "balanced";

export function getPresetById(id: KickoffModelPresetId): KickoffModelPreset {
  return KICKOFF_MODEL_PRESETS.find((preset) => preset.id === id) ?? KICKOFF_MODEL_PRESETS[1]!;
}

export const KICKOFF_PERSONA_OPTIONS = ["tech-lead", "coder", "reviewer", "qa-tester"] as const;
