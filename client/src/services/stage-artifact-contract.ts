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

function productPlanRel(runDir: string): string {
  return joinPosix(runDir, "product-plan.md");
}

function productAcceptanceCriteriaRel(runDir: string): string {
  return joinPosix(runDir, "product-acceptance-criteria.md");
}

function designPlanRel(runDir: string): string {
  return joinPosix(runDir, "design-plan.md");
}

function designAcceptanceCriteriaRel(runDir: string): string {
  return joinPosix(runDir, "design-acceptance-criteria.md");
}

function techPlanRel(runDir: string): string {
  return joinPosix(runDir, "tech-plan.md");
}

function techAcceptanceCriteriaRel(runDir: string): string {
  return joinPosix(runDir, "tech-acceptance-criteria.md");
}

function manualQaTestCasesRel(runDir: string): string {
  return joinPosix(runDir, "manual-qa-test-cases.md");
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

  switch (stage) {
    case "plan": {
      const plan = joinPosix(runDir, "plan.md");
      const adr = joinPosix(runDir, "adr-draft.md");
      const touchSet = joinPosix(runDir, "touch-set.json");
      const handoff = handoffPath(runDir);
      return [
        productPlanRel(runDir),
        productAcceptanceCriteriaRel(runDir),
        designPlanRel(runDir),
        designAcceptanceCriteriaRel(runDir),
        uxSpecRel(featureId),
        techPlanRel(runDir),
        techAcceptanceCriteriaRel(runDir),
        manualQaTestCasesRel(runDir),
        plan,
        adr,
        touchSet,
        handoff,
      ];
    }
    case "implement": {
      return [joinPosix(runDir, "implementation-report.md")];
    }
    case "review": {
      return [joinPosix(runDir, "review.md")];
    }
    case "test": {
      const testReport = joinPosix(runDir, "test-report.md");
      return [testReport, designQaReportRel(runDir)];
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
