/**
 * Client-side mirror of requiredAfterStageWork paths from
 * lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts
 */

export type StageArtifactContractInput = {
  featureId: string;
  runDir: string;
  designSteps?: boolean;
};

function joinPosix(...segments: string[]): string {
  return segments.filter(Boolean).join("/");
}

function uxSpecRel(featureId: string): string {
  return joinPosix("lib", "memory", "features", featureId, "ux-spec.md");
}

function designQaReportRel(runDir: string): string {
  return joinPosix(runDir, "design-qa-report.md");
}

function handoffPath(runDir: string): string {
  return joinPosix(runDir, "handoff.md");
}

/** Returns repo-relative paths that MUST exist after stage work completes. */
export function stageArtifactPathsForStage(
  input: StageArtifactContractInput,
  stage: string,
): readonly string[] {
  const { featureId, runDir } = input;
  const designSteps = input.designSteps ?? false;

  switch (stage) {
    case "intake": {
      const spec = joinPosix("lib", "memory", "features", featureId, "spec.md");
      return [spec];
    }
    case "plan": {
      const plan = joinPosix(runDir, "plan.md");
      const adr = joinPosix(runDir, "adr-draft.md");
      const touchSet = joinPosix(runDir, "touch-set.json");
      const handoff = handoffPath(runDir);
      return designSteps ? [uxSpecRel(featureId), plan, adr, touchSet, handoff] : [plan, adr, touchSet, handoff];
    }
    case "implement": {
      return [joinPosix(runDir, "implementation-report.md")];
    }
    case "review": {
      return [joinPosix(runDir, "review.md")];
    }
    case "test": {
      const testReport = joinPosix(runDir, "test-report.md");
      return designSteps ? [testReport, designQaReportRel(runDir)] : [testReport];
    }
    case "report": {
      return [joinPosix("lib", "memory", "features", featureId, "delivery-report.md")];
    }
    case "compliance": {
      return [joinPosix(runDir, "compliance-result.json")];
    }
    case "ship": {
      return [joinPosix(runDir, "ship-ratification.json")];
    }
    case "index": {
      return [joinPosix("lib", "memory", "features", featureId, "index.json")];
    }
    default:
      return [];
  }
}
