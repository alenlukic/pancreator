export type KickoffStepId = "source" | "preview" | "models" | "review";

export type KickoffSourceKind = "inbox" | "url" | "raw-text" | "backlog" | "interactive";

export type KickoffLaunchResult = {
  taskId: string;
  featureId: string;
  runDir: string;
  handoffFile: string;
};

export type KickoffSourceState = {
  kind: KickoffSourceKind;
  inboxPath?: string;
  inboxTitle?: string;
  url?: string;
  rawText?: string;
};

export type PersonaModelOverride = {
  persona: string;
  model: string;
};

export type KickoffModelPresetId = "cheap-fast" | "balanced" | "high-quality";

export type KickoffFlowState = {
  stepIndex: number;
  source: KickoffSourceState | null;
  directiveMarkdown: string;
  savedInboxPath: string | null;
  presetId: KickoffModelPresetId;
  personaOverrides: PersonaModelOverride[];
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  saveSuccessPath: string | null;
  launchResult: KickoffLaunchResult | null;
  launchError: string | null;
};

export const KICKOFF_STEPS: { id: KickoffStepId; label: string; shortLabel: string }[] = [
  { id: "source", label: "Choose source", shortLabel: "Source" },
  { id: "preview", label: "Preview directive", shortLabel: "Preview" },
  { id: "models", label: "Configure models", shortLabel: "Models" },
  { id: "review", label: "Review and launch", shortLabel: "Review" },
];
