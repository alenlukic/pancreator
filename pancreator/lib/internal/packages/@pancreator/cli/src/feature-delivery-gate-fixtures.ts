/** Valid minimal gate artifact bodies for CLI integration tests. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson, stringifyCompactJson } from "./canonical-json-io.js";

function buildOutputManifestMarkdown(input: {
  personaContract: string;
  stageContract?: string;
  requiredDocs?: string[];
  consultedDocs?: string[];
  producedArtifacts?: string;
  scopeAmendments?: string;
  validation?: string;
  definitionOfDone?: string;
  gateDecision?: string;
  remediationRoute?: string;
}): string {
  return [
    "## Output manifest",
    "",
    `- persona_contract: ${input.personaContract}`,
    `- stage_contract: ${input.stageContract ?? "none"}`,
    `- required_docs: ${(input.requiredDocs ?? ["DOC.AGENTS", "DOC.REGISTRY", "DOC.OUTPUT_MANIFEST"]).join(", ")}`,
    `- consulted_docs: ${(input.consultedDocs ?? ["DOC.AGENTS", "DOC.REGISTRY", "DOC.OUTPUT_MANIFEST"]).join(", ")}`,
    `- produced_artifacts: ${input.producedArtifacts ?? "none"}`,
    `- scope_amendments: ${input.scopeAmendments ?? "none"}`,
    `- validation: ${input.validation ?? "none"}`,
    `- definition_of_done: ${input.definitionOfDone ?? "pass"}`,
    `- gate_decision: ${input.gateDecision ?? "advance"}`,
    `- remediation_route: ${input.remediationRoute ?? "none"}`,
  ].join("\n");
}

const VALID_OUTPUT_MANIFEST_MARKDOWN = buildOutputManifestMarkdown({
  personaContract: "PERSONA.TEST",
});

/** Mirror `pancreator-required-docs` on stage personas so receipt attestation passes in SDK tests. */
const IMPLEMENT_STAGE_MANIFEST_DOCS = [
  "DOC.AGENTS",
  "DOC.REGISTRY",
  "DOC.PERSONA_CONTRACTS",
  "DOC.OUTPUT_MANIFEST",
  "PIPE.FEATURE_DELIVERY",
  "DOC.ENG_SOFTWARE",
  "DOC.ENG_TYPESCRIPT",
  "DOC.COMPLIANCE_RUNS",
  "DOC.PERSONA_SPEC",
  "DOC.GLOSSARY",
  "DOC.CONTRACT_STYLE",
] as const;

const REVIEW_STAGE_MANIFEST_DOCS = [
  ...IMPLEMENT_STAGE_MANIFEST_DOCS,
  "DOC.CONTRACT_FORMAT",
] as const;

const TEST_STAGE_MANIFEST_DOCS = [
  "DOC.AGENTS",
  "DOC.REGISTRY",
  "DOC.PERSONA_CONTRACTS",
  "DOC.OUTPUT_MANIFEST",
  "PIPE.FEATURE_DELIVERY",
  "DOC.ENG_SOFTWARE",
  "DOC.ENG_TYPESCRIPT",
  "DOC.DESIGN_CRAFT",
  "DOC.COMPLIANCE_RUNS",
  "DOC.PERSONA_SPEC",
  "DOC.GLOSSARY",
  "DOC.CONTRACT_STYLE",
] as const;

const REPORT_STAGE_MANIFEST_DOCS = [
  "DOC.AGENTS",
  "DOC.REGISTRY",
  "DOC.PERSONA_CONTRACTS",
  "DOC.OUTPUT_MANIFEST",
  "PIPE.FEATURE_DELIVERY",
  "DOC.OPERATOR_OUTPUT",
  "DOC.RUN_LOG_SCHEMA",
  "DOC.PERSONA_SPEC",
  "DOC.GLOSSARY",
  "DOC.CONTRACT_STYLE",
  "DOC.DELIVERY_REPORT_TEMPLATE",
] as const;

const COMPLIANCE_STAGE_MANIFEST_DOCS = [
  "DOC.AGENTS",
  "DOC.REGISTRY",
  "DOC.PERSONA_CONTRACTS",
  "DOC.OUTPUT_MANIFEST",
  "PIPE.FEATURE_DELIVERY",
  "DOC.COMPLIANCE_RUNS",
  "DOC.RUN_LOG_SCHEMA",
  "DOC.OPERATOR_OUTPUT",
  "DOC.PERSONA_SPEC",
  "DOC.GLOSSARY",
  "DOC.CONTRACT_STYLE",
  "DOC.CONTRACT_FORMAT",
] as const;

const VALID_IMPLEMENT_OUTPUT_MANIFEST_MARKDOWN = buildOutputManifestMarkdown({
  personaContract: "PERSONA.CODER",
  stageContract: "PIPE.FEATURE_DELIVERY.IMPLEMENT",
  requiredDocs: [...IMPLEMENT_STAGE_MANIFEST_DOCS],
  consultedDocs: [...IMPLEMENT_STAGE_MANIFEST_DOCS],
});

const VALID_REVIEW_OUTPUT_MANIFEST_MARKDOWN = buildOutputManifestMarkdown({
  personaContract: "PERSONA.REVIEWER",
  stageContract: "PIPE.FEATURE_DELIVERY.REVIEW",
  requiredDocs: [...REVIEW_STAGE_MANIFEST_DOCS],
  consultedDocs: [...REVIEW_STAGE_MANIFEST_DOCS],
});

const VALID_TEST_OUTPUT_MANIFEST_MARKDOWN = buildOutputManifestMarkdown({
  personaContract: "PERSONA.QA_TESTER",
  stageContract: "PIPE.FEATURE_DELIVERY.TEST",
  requiredDocs: [...TEST_STAGE_MANIFEST_DOCS],
  consultedDocs: [...TEST_STAGE_MANIFEST_DOCS],
});

const VALID_REPORT_OUTPUT_MANIFEST_MARKDOWN = buildOutputManifestMarkdown({
  personaContract: "PERSONA.TECH_WRITER",
  stageContract: "PIPE.FEATURE_DELIVERY.REPORT",
  requiredDocs: [...REPORT_STAGE_MANIFEST_DOCS],
  consultedDocs: [...REPORT_STAGE_MANIFEST_DOCS],
});

export const VALID_PLAN_MARKDOWN = [
  "# Plan",
  "",
  "## Architecture",
  "",
  "Summary.",
  "",
  "## Acceptance criteria",
  "",
  "1. AC-1: behavior verified.",
  "",
  "## Shared-layer impact",
  "",
  "none",
  "",
  "## Tasks",
  "",
  "1. Implement.",
  "",
  VALID_OUTPUT_MANIFEST_MARKDOWN,
].join("\n");

export const VALID_HANDOFF_MARKDOWN = `# Handoff\n\n## Validation commands\n\n- pnpm test (coder)\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_TOUCH_SET_JSON = stringifyCompactJson({
  paths: [{ path: "client/foo.ts", status: "existing" }],
  symbols: [],
  tests: [{ kind: "command", command: "pnpm test" }],
  shared_paths: [],
  integration_prerequisites: [],
  acceptance_criteria: [
    { id: "AC-1", criterion: "verified", validation_owner: "qa-tester" },
  ],
  manual_qa_test_cases: [
    {
      id: "MQA-1",
      steps: ["Open the affected surface"],
      expected: "Behavior matches AC-1",
    },
  ],
  amendments: [],
});

export const VALID_IMPLEMENTATION_REPORT_MARKDOWN = [
  "implement_gate_passes: true",
  "scope_amendments: none",
  "",
  "## Acceptance criteria",
  "",
  "- AC-1: pass",
  "",
  "## Automated checks",
  "",
  "| command | exit code | pass/fail |",
  "| pnpm lint | 0 | pass |",
  "| pnpm typecheck | 0 | pass |",
  "| pnpm test | 0 | pass |",
  "",
  "## Coverage delta",
  "",
  "statement: 85%",
  "",
  VALID_IMPLEMENT_OUTPUT_MANIFEST_MARKDOWN,
].join("\n");

export const VALID_REVIEW_MARKDOWN = `review_passes: true\ntouch_set_tests_pass: true\nlint_typecheck_rerun_required: false\nscope_amendments_ratified: true\n\n${VALID_REVIEW_OUTPUT_MANIFEST_MARKDOWN}\n`;
export const VALID_REVIEW_FAIL_MARKDOWN = `review_passes: false\ntouch_set_tests_pass: false\nlint_typecheck_rerun_required: false\nscope_amendments_ratified: true\n\n${VALID_REVIEW_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_ADR_MARKDOWN = `# ADR\n\n## Decision\n\nBody.\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_UX_SPEC_MARKDOWN = `# UX spec\n\n## Surface\n\nPanel layout.\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_COMPANION_PLAN_MARKDOWN = `# Plan\n\n## Plan\n\nSteps.\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_ACCEPTANCE_CRITERIA_MARKDOWN = `# Acceptance criteria\n\n## Criteria\n\n- AC-1: verified.\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;

export const VALID_MANUAL_QA_MARKDOWN = `# Manual QA test cases\n\n## MQA-1\n\nSteps and expected result.\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;
export const VALID_DELIVERY_REPORT_MARKDOWN = `# Delivery report\n\n## Summary\n\nShipped.\n\n${VALID_REPORT_OUTPUT_MANIFEST_MARKDOWN}\n`;

export function validComplianceResultJson(repoRoot: string): string {
  return stringifyCliJson(repoRoot, {
    compliance_passes: true,
    final_gate: {
      "pnpm lint": 0,
      "pnpm typecheck": 0,
      "pnpm test": 0,
      "node --test tests/*.test.mjs": 0,
    },
    output_manifest: {
      persona_contract: "PERSONA.COMPLIANCE_AUDITOR",
      stage_contract: "PIPE.FEATURE_DELIVERY.COMPLIANCE",
      required_docs: [...COMPLIANCE_STAGE_MANIFEST_DOCS],
      consulted_docs: [...COMPLIANCE_STAGE_MANIFEST_DOCS],
      produced_artifacts: [".pan/work/day/task/compliance-result.json"],
      scope_amendments: [],
      validation: [{ name: "gate", result: "pass" }],
      definition_of_done: "pass",
      gate_decision: "advance",
      remediation_route: "none",
    },
  });
}

export function planStageRequiredArtifactRels(
  runDirRel: string,
  _featureId: string,
): string[] {
  return [
    `${runDirRel}/product/plan.md`,
    `${runDirRel}/product/acceptance-criteria.md`,
    `${runDirRel}/tech/plan.md`,
    `${runDirRel}/tech/acceptance-criteria.md`,
    `${runDirRel}/manual-qa-test-cases.md`,
    `${runDirRel}/plan.md`,
    `${runDirRel}/adr-draft.md`,
    `${runDirRel}/touch-set.json`,
    `${runDirRel}/handoff.md`,
    `${runDirRel}/design/plan.md`,
    `${runDirRel}/design/acceptance-criteria.md`,
    `${runDirRel}/ux-spec.md`,
  ];
}

export async function seedPlanStageAdvanceArtifacts(
  root: string,
  runDirRel: string,
  _featureId = "demo-feature",
): Promise<void> {
  const runDir = path.join(root, runDirRel);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(runDir, "product"), { recursive: true });
  await mkdir(path.join(runDir, "design"), { recursive: true });
  await mkdir(path.join(runDir, "tech"), { recursive: true });
  await writeFile(path.join(runDir, "plan.md"), VALID_PLAN_MARKDOWN, "utf8");
  await writeFile(
    path.join(runDir, "adr-draft.md"),
    VALID_ADR_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "touch-set.json"),
    VALID_TOUCH_SET_JSON,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "handoff.md"),
    VALID_HANDOFF_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "product", "plan.md"),
    VALID_COMPANION_PLAN_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "product", "acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "design", "plan.md"),
    VALID_COMPANION_PLAN_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "design", "acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "tech", "plan.md"),
    VALID_COMPANION_PLAN_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "tech", "acceptance-criteria.md"),
    VALID_ACCEPTANCE_CRITERIA_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "manual-qa-test-cases.md"),
    VALID_MANUAL_QA_MARKDOWN,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "ux-spec.md"),
    VALID_UX_SPEC_MARKDOWN,
    "utf8",
  );
}

export async function seedTestStageAdvanceArtifacts(
  root: string,
  runDirRel: string,
): Promise<void> {
  const runDir = path.join(root, runDirRel);
  await writeFile(
    path.join(runDir, "test-report.md"),
    `qa_passes: true\n\n${VALID_TEST_OUTPUT_MANIFEST_MARKDOWN}\n`,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "design-qa-report.md"),
    `design_qa_passes: true\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`,
    "utf8",
  );
}

export function gateFixtureBody(repoRoot: string, rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  if (base === "plan.md") return VALID_PLAN_MARKDOWN;
  if (base === "handoff.md") return VALID_HANDOFF_MARKDOWN;
  if (base === "touch-set.json") return VALID_TOUCH_SET_JSON;
  if (base === "implementation-report.md")
    return VALID_IMPLEMENTATION_REPORT_MARKDOWN;
  if (base === "review.md") return VALID_REVIEW_MARKDOWN;
  if (base === "delivery-report.md") return VALID_DELIVERY_REPORT_MARKDOWN;
  if (base === "test-report.md")
    return `qa_passes: true\n\n${VALID_TEST_OUTPUT_MANIFEST_MARKDOWN}\n`;
  if (base === "design-qa-report.md")
    return `design_qa_passes: true\n\n${VALID_OUTPUT_MANIFEST_MARKDOWN}\n`;
  if (base === "manual-qa-test-cases.md") return VALID_MANUAL_QA_MARKDOWN;
  if (base.endsWith("acceptance-criteria.md"))
    return VALID_ACCEPTANCE_CRITERIA_MARKDOWN;
  if (base.endsWith("plan.md")) return VALID_COMPANION_PLAN_MARKDOWN;
  if (base === "adr-draft.md") return VALID_ADR_MARKDOWN;
  if (base === "ux-spec.md") return VALID_UX_SPEC_MARKDOWN;
  if (base === "compliance-result.json") {
    return validComplianceResultJson(repoRoot);
  }
  if (base === "ship-ratification.json") {
    return stringifyCliJson(repoRoot, {
      task_id: "mock-task",
      human_ratified_diff: true,
    });
  }
  return "mock-artifact\n";
}
