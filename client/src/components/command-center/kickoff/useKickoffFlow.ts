"use client";

import { useCallback, useMemo, useState } from "react";
import { quoteJsonString } from "@/lib/json-io";
import type { InboxEntrySnapshot } from "@/services/inbox";
import { DEFAULT_PRESET_ID } from "./kickoff-model-presets";
import type {
  KickoffFlowState,
  KickoffLaunchResult,
  KickoffModelPresetId,
  KickoffSourceKind,
  PersonaModelOverride,
} from "./kickoff-types";
import { KICKOFF_STEPS } from "./kickoff-types";

function buildRawTextSeed(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("---")) {
    return trimmed;
  }
  const title = trimmed.split("\n").find((line) => line.startsWith("# "))?.slice(2).trim() ?? "Kickoff directive";
  const createdIso = new Date().toISOString();
  return [
    "---",
    `title: ${quoteJsonString(title)}`,
    "feature_id: kickoff-directive",
    "stage: intake",
    "owner: intake-analyst",
    "status: open",
    `created_at: ${quoteJsonString(createdIso)}`,
    "references: []",
    "---",
    "",
    trimmed,
    "",
  ].join("\n");
}

function initialState(): KickoffFlowState {
  return {
    stepIndex: 0,
    source: null,
    directiveMarkdown: "",
    savedInboxPath: null,
    presetId: DEFAULT_PRESET_ID,
    personaOverrides: [],
    loading: false,
    loadingLabel: "",
    error: null,
    saveSuccessPath: null,
    launchResult: null,
    launchError: null,
  };
}

export function useKickoffFlow() {
  const [state, setState] = useState<KickoffFlowState>(initialState);

  const currentStep = KICKOFF_STEPS[state.stepIndex] ?? KICKOFF_STEPS[0]!;

  const canContinue = useMemo(() => {
    if (state.source === null) {
      return false;
    }
    switch (state.source.kind) {
      case "inbox":
        return state.source.inboxPath !== undefined && state.source.inboxPath.length > 0;
      case "url":
        return state.source.url !== undefined && state.source.url.length > 0 && state.directiveMarkdown.length > 0;
      case "raw-text":
        return state.source.rawText !== undefined && state.source.rawText.trim().length > 0;
      case "backlog":
      case "interactive":
        return false;
      default:
        return false;
    }
  }, [state.directiveMarkdown.length, state.source]);

  const continueDisabledReason = useMemo(() => {
    if (state.source === null) {
      return "Select a work source to continue.";
    }
    if (state.source.kind === "backlog") {
      return "Feature backlog browse is not available yet. Choose inbox, URL, or raw text.";
    }
    if (state.source.kind === "interactive") {
      return "Interactive intake is optional. Choose inbox, URL, or raw text to continue.";
    }
    if (!canContinue) {
      return "Complete the selected source before continuing.";
    }
    return "";
  }, [canContinue, state.source]);

  const setSourceKind = useCallback((kind: KickoffSourceKind) => {
    setState((prev) => ({
      ...prev,
      source: { kind },
      error: null,
      launchError: null,
    }));
  }, []);

  const selectInboxEntry = useCallback((entry: InboxEntrySnapshot) => {
    setState((prev) => ({
      ...prev,
      source: {
        kind: "inbox",
        inboxPath: entry.path,
        inboxTitle: entry.title,
      },
      error: null,
    }));
  }, []);

  const setUrl = useCallback((url: string) => {
    setState((prev) => ({
      ...prev,
      source: { kind: "url", url },
      error: null,
    }));
  }, []);

  const setRawText = useCallback((rawText: string) => {
    setState((prev) => ({
      ...prev,
      source: { kind: "raw-text", rawText },
      directiveMarkdown: buildRawTextSeed(rawText),
      error: null,
    }));
  }, []);

  const setDirectiveMarkdown = useCallback((markdown: string) => {
    setState((prev) => ({ ...prev, directiveMarkdown: markdown }));
  }, []);

  const setPresetId = useCallback((presetId: KickoffModelPresetId) => {
    setState((prev) => ({ ...prev, presetId }));
  }, []);

  const setPersonaOverrides = useCallback((personaOverrides: PersonaModelOverride[]) => {
    setState((prev) => ({ ...prev, personaOverrides }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      stepIndex: Math.max(0, prev.stepIndex - 1),
      error: null,
      launchError: null,
    }));
  }, []);

  const goForward = useCallback(() => {
    setState((prev) => {
      if (prev.stepIndex >= KICKOFF_STEPS.length - 1) {
        return prev;
      }
      let directiveMarkdown = prev.directiveMarkdown;
      if (prev.stepIndex === 0 && prev.source?.kind === "raw-text" && prev.source.rawText !== undefined) {
        directiveMarkdown = buildRawTextSeed(prev.source.rawText);
      }
      return {
        ...prev,
        stepIndex: prev.stepIndex + 1,
        directiveMarkdown,
        error: null,
      };
    });
  }, []);

  const setLoading = useCallback((loading: boolean, loadingLabel = "") => {
    setState((prev) => ({ ...prev, loading, loadingLabel }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setSaveSuccessPath = useCallback((saveSuccessPath: string | null) => {
    setState((prev) => ({ ...prev, saveSuccessPath, savedInboxPath: saveSuccessPath ?? prev.savedInboxPath }));
  }, []);

  const setLaunchResult = useCallback((launchResult: KickoffLaunchResult | null) => {
    setState((prev) => ({ ...prev, launchResult, launchError: null }));
  }, []);

  const setLaunchError = useCallback((launchError: string | null) => {
    setState((prev) => ({ ...prev, launchError, launchResult: null }));
  }, []);

  const applyUrlSeed = useCallback((directiveSeed: string, url: string) => {
    setState((prev) => ({
      ...prev,
      source: { kind: "url", url },
      directiveMarkdown: directiveSeed,
      error: null,
    }));
  }, []);

  const sourceLabel = useMemo(() => {
    if (state.source === null) {
      return "No source selected";
    }
    switch (state.source.kind) {
      case "inbox":
        return state.source.inboxTitle ?? "Inbox directive";
      case "url":
        return "Page URL";
      case "raw-text":
        return "Raw text";
      case "backlog":
        return "Feature backlog";
      case "interactive":
        return "Interactive intake";
      default:
        return "Work source";
    }
  }, [state.source]);

  const launchInboxPath = useMemo(() => {
    if (state.savedInboxPath !== null) {
      return state.savedInboxPath;
    }
    if (state.source?.kind === "inbox" && state.source.inboxPath !== undefined) {
      return state.source.inboxPath;
    }
    return null;
  }, [state.savedInboxPath, state.source]);

  return {
    state,
    currentStep,
    canContinue,
    continueDisabledReason,
    sourceLabel,
    launchInboxPath,
    setSourceKind,
    selectInboxEntry,
    setUrl,
    setRawText,
    setDirectiveMarkdown,
    setPresetId,
    setPersonaOverrides,
    goBack,
    goForward,
    setLoading,
    setError,
    setSaveSuccessPath,
    setLaunchResult,
    setLaunchError,
    applyUrlSeed,
  };
}

export type KickoffFlowApi = ReturnType<typeof useKickoffFlow>;
