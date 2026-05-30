import path from "node:path";
import { existsSync } from "node:fs";

/** Minimal state slice for artifact path resolution without importing feature-delivery-run. */
export interface FeatureDeliveryArtifactState {
  featureId: string;
  artifacts: {
    runDir: string;
    handoffFile?: string;
  };
}

function handoffPath(state: FeatureDeliveryArtifactState): string {
  return state.artifacts.handoffFile ?? path.posix.join(state.artifacts.runDir, "handoff.md");
}

export interface StageArtifactContract {
  /** Primary artifact referenced on advance commands and in run logs. */
  primaryArtifact: string;
  /** All repo-relative paths that MUST exist after stage work completes. */
  requiredAfterStageWork: readonly string[];
  /** Paths accepted as `--artifact` on advance for the default stage event. */
  acceptedAdvanceArtifacts: readonly string[];
}

export interface StageArtifactValidation {
  ok: boolean;
  missing: string[];
  present: string[];
}

const STAGE_IDS = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "ship",
  "index",
] as const;

export type FeatureDeliveryStageId = (typeof STAGE_IDS)[number];

export function isFeatureDeliveryStageId(stage: string): stage is FeatureDeliveryStageId {
  return (STAGE_IDS as readonly string[]).includes(stage);
}

export function stageArtifactContract(
  state: FeatureDeliveryArtifactState,
  stage: string,
  event = defaultAdvanceEventForStage(stage),
): StageArtifactContract {
  const run = state.artifacts.runDir;
  switch (stage) {
    case "intake": {
      const spec = path.posix.join("lib", "memory", "features", state.featureId, "spec.md");
      return {
        primaryArtifact: spec,
        requiredAfterStageWork: [spec],
        acceptedAdvanceArtifacts: [spec],
      };
    }
    case "plan": {
      const plan = path.posix.join(run, "plan.md");
      const adr = path.posix.join(run, "adr-draft.md");
      const touchSet = path.posix.join(run, "touch-set.json");
      const handoff = handoffPath(state);
      const requiredAfterStageWork = [plan, adr, touchSet, handoff];
      const acceptedAdvanceArtifacts = [plan, touchSet, handoff];
      return {
        primaryArtifact: touchSet,
        requiredAfterStageWork,
        acceptedAdvanceArtifacts,
      };
    }
    case "implement": {
      const report = path.posix.join(run, "implementation-report.md");
      return {
        primaryArtifact: report,
        requiredAfterStageWork: [report],
        acceptedAdvanceArtifacts: [report],
      };
    }
    case "review": {
      const review = path.posix.join(run, "review.md");
      if (event !== "review_passes" && event !== "must_fix") {
        throw new Error(`Review stage only supports review_passes or must_fix, got ${event}.`);
      }
      return {
        primaryArtifact: review,
        requiredAfterStageWork: [review],
        acceptedAdvanceArtifacts: [review],
      };
    }
    case "test": {
      const testReport = path.posix.join(run, "test-report.md");
      if (event !== "qa_passes" && event !== "qa_fails" && event !== "qa_fails_plan_invalidating") {
        throw new Error(
          `Test stage only supports qa_passes, qa_fails, or qa_fails_plan_invalidating, got ${event}.`,
        );
      }
      return {
        primaryArtifact: testReport,
        requiredAfterStageWork: [testReport],
        acceptedAdvanceArtifacts: [testReport],
      };
    }
    case "report": {
      const deliveryReport = path.posix.join(
        "lib",
        "memory",
        "features",
        state.featureId,
        "delivery-report.md",
      );
      return {
        primaryArtifact: deliveryReport,
        requiredAfterStageWork: [deliveryReport],
        acceptedAdvanceArtifacts: [deliveryReport],
      };
    }
    case "ship": {
      const policy = path.posix.join(run, "policy-compliance.json");
      return {
        primaryArtifact: policy,
        requiredAfterStageWork: [policy],
        acceptedAdvanceArtifacts: [policy],
      };
    }
    case "index": {
      const index = path.posix.join("lib", "memory", "features", state.featureId, "index.json");
      return {
        primaryArtifact: index,
        requiredAfterStageWork: [index],
        acceptedAdvanceArtifacts: [index],
      };
    }
    default:
      throw new Error(`No artifact contract for stage ${stage}.`);
  }
}

export function primaryArtifactForEnteringStage(
  state: FeatureDeliveryArtifactState,
  stageId: string,
): string {
  return stageArtifactContract(state, stageId).primaryArtifact;
}

export function requiredArtifactsAfterStageWork(
  state: FeatureDeliveryArtifactState,
  stageId: string,
): readonly string[] {
  return stageArtifactContract(state, stageId).requiredAfterStageWork;
}

export function validateStageCompletionArtifacts(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stageId: string,
): StageArtifactValidation {
  const required = requiredArtifactsAfterStageWork(state, stageId);
  const missing: string[] = [];
  const present: string[] = [];
  for (const rel of required) {
    if (existsSync(path.join(repoRoot, rel))) {
      present.push(rel);
    } else {
      missing.push(rel);
    }
  }
  return { ok: missing.length === 0, missing, present };
}

export function assertAdvanceArtifacts(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stage: string,
  artifact: string,
  event: string,
): void {
  const contract = stageArtifactContract(state, stage, event);
  if (!contract.acceptedAdvanceArtifacts.includes(artifact)) {
    throw new Error(
      `Artifact ${artifact} is not valid for ${stage} on ${event}; expected one of: ${contract.acceptedAdvanceArtifacts.join(", ")}.`,
    );
  }
  for (const required of contract.acceptedAdvanceArtifacts) {
    if (!existsSync(path.join(repoRoot, required))) {
      throw new Error(`Cannot advance ${stage}; required artifact is missing: ${required}.`);
    }
  }
}

function defaultAdvanceEventForStage(stage: string): string {
  switch (stage) {
    case "intake":
    case "plan":
      return "human_approval";
    case "implement":
      return "implementation_complete";
    case "review":
      return "review_passes";
    case "test":
      return "qa_passes";
    case "report":
      return "report_ready";
    case "ship":
      return "human_ratifies_local_diff";
    case "index":
      return "artifacts_indexed";
    default:
      throw new Error(`No default advance event for stage ${stage}.`);
  }
}
