import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePath } from "./paths.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TASK_IDS = ["task-low", "task-high"];
export const PROTOTYPE_MODELS = ["composer-2.5", "gpt-5.5"];

/** Paths that MUST NOT appear in tool logs unless a task overrides. */
export const COMMON_FORBIDDEN_PATH_PATTERNS = [
  /^docs\/PRD\.md$/i,
  /^docs\/BOOTSTRAP\.md$/i,
  /^archive\/work\//i,
  /^archive\/inbox\//i,
  /^lib\/inbox\/notes\//i,
  /^lib\/inbox\//i,
];

/**
 * @typedef {{
 *   id: string;
 *   fixtureRoot: string;
 *   readAllowlist: string[];
 *   requiredReadPaths: string[];
 *   forbiddenPathPatterns: RegExp[];
 *   decoyPaths: string[];
 *   requiredOutputArtifacts: string[];
 *   requiresWrites: boolean;
 *   maxTurns: number;
 *   expectedAnswers: Record<string, string | number>;
 * }} TaskSpec
 */

/** @type {Record<string, TaskSpec>} */
const TASK_SPECS = {
  "task-low": {
    id: "task-low",
    fixtureRoot: path.join(HARNESS_ROOT, "fixtures", "task-low"),
    readAllowlist: [
      "AGENTS.md",
      "docs/PRD.summary.md",
      "lib/memory/active/current.md",
      "lib/memory/handbook/routing.md",
      "work/99999_probe/task/handoff.md",
    ],
    requiredReadPaths: [
      "lib/memory/active/current.md",
      "lib/memory/handbook/routing.md",
      "docs/PRD.summary.md",
      "work/99999_probe/task/handoff.md",
    ],
    forbiddenPathPatterns: COMMON_FORBIDDEN_PATH_PATTERNS,
    decoyPaths: ["docs/PRD.md", "lib/inbox/notes/private.md"],
    requiredOutputArtifacts: [],
    requiresWrites: false,
    maxTurns: 6,
    expectedAnswers: {
      active_feature: "token-economy-probe-low",
      handbook_anchor: "alpha-7f3c",
      product_route_token: "route-summary-only",
      handoff_stage: "implement",
    },
  },
  "task-high": {
    id: "task-high",
    fixtureRoot: path.join(HARNESS_ROOT, "fixtures", "task-high"),
    readAllowlist: [
      "AGENTS.md",
      "docs/PRD.summary.md",
      "lib/memory/active/current.md",
      "lib/memory/handbook/routing.md",
      "lib/internal/packages/demo-svc/handler.ts",
      "work/99999_probe/task/handoff.md",
    ],
    requiredReadPaths: [
      "lib/memory/active/current.md",
      "lib/internal/packages/demo-svc/handler.ts",
      "work/99999_probe/task/handoff.md",
    ],
    forbiddenPathPatterns: COMMON_FORBIDDEN_PATH_PATTERNS,
    decoyPaths: ["docs/PRD.md", "lib/inbox/notes/private.md"],
    requiredOutputArtifacts: ["work/99999_probe/task/answer.md"],
    requiresWrites: true,
    maxTurns: 10,
    expectedAnswers: {
      handler_export_count: 2,
      durable_spec_anchor: "token-economy-probe-high",
    },
  },
};

/**
 * @param {string} taskId
 * @returns {TaskSpec}
 */
export function getTaskSpec(taskId) {
  const spec = TASK_SPECS[taskId];
  if (!spec) {
    throw new Error(
      `Unknown prototype task "${taskId}". Known tasks: ${TASK_IDS.join(", ")}`,
    );
  }
  return spec;
}

/**
 * @param {string} taskId
 */
export function buildTaskPrompt(taskId) {
  const spec = getTaskSpec(taskId);
  const allowlist = spec.readAllowlist.map((p) => `- ${p}`).join("\n");
  const requiredReads = spec.requiredReadPaths.map((p) => `- ${p}`).join("\n");
  const forbidden = [
    "docs/PRD.md",
    "docs/BOOTSTRAP.md",
    "archive/work/",
    "lib/inbox/",
    "lib/inbox/notes/",
  ]
    .map((p) => `- ${p}`)
    .join("\n");

  if (taskId === "task-low") {
    return `
Prototype task-low (routing only — no writes).

Read only from this allowlist:
${allowlist}

Required reads (answer from these only):
${requiredReads}

Do NOT read:
${forbidden}

Do not call write or edit tools.

Reply with a single JSON object (no markdown fence) containing exactly:
{
  "active_feature": "<from lib/memory/active/current.md>",
  "handbook_anchor": "<anchor string from lib/memory/handbook/routing.md>",
  "product_route_token": "<from docs/PRD.summary.md>",
  "handoff_stage": "<HANDOFF_STAGE from work/99999_probe/task/handoff.md>"
}
`.trim();
  }

  return `
Prototype task-high (bounded edit task).

Read only from this allowlist:
${allowlist}

Required reads:
${requiredReads}

Do NOT read:
${forbidden}

You MUST write exactly one file: work/99999_probe/task/answer.md

The answer file MUST be JSON with:
{
  "handler_export_count": <number of export declarations in handler.ts>,
  "durable_spec_anchor": "<DURABLE_SPEC_ANCHOR from lib/memory/features/token-economy-probe/spec.md>"
}

Use edit or write tools only for work/99999_probe/task/answer.md.
`.trim();
}

/**
 * Combo key for trace and baseline paths.
 * @param {string} taskId
 * @param {string} modelId
 */
export function comboKey(taskId, modelId) {
  return `${taskId}.${normalizePath(modelId)}`;
}

/**
 * @param {string} harnessRoot
 * @param {string} taskId
 * @param {string} modelId
 */
export function resolveExpectedBaselinePath(harnessRoot, taskId, modelId) {
  return path.join(harnessRoot, "baselines", `expected.${comboKey(taskId, modelId)}.json`);
}
