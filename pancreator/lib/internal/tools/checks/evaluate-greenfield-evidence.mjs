#!/usr/bin/env node
/**
 * Deterministic evaluator for greenfield US-9 evidence artifacts.
 * Emits pass, fail, or fail-with-gaps without opening the external monorepo.
 *
 * Usage:
 *   node lib/internal/tools/checks/evaluate-greenfield-evidence.mjs --input <artifact.json>
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stringifyRepoJson } from "../format/canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

export const VERDICTS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  FAIL_WITH_GAPS: "fail-with-gaps",
});

const REQUIRED_TOP_LEVEL = [
  "schema_version",
  "artifact_kind",
  "metadata",
  "provenance",
  "checklist",
  "verdict_preconditions",
];

const REQUIRED_CHECKLIST_KEYS = [
  "agents_md_present",
  "handbook_seeds_present",
  "persona_roster_present",
  "feature_spec_authored",
  "plan_touch_set_authored",
  "no_overwritten_existing_files",
];

const REQUIRED_STAGES = ["scaffold", "spec", "plan"];

const ALLOWED_PROJECT_ROOT = new Set([".", ".pancreator"]);

/** Project-relative path prefixes that MUST NOT appear in embedded/greenfield evidence. */
export const DENY_LIST_PREFIXES = Object.freeze([
  ".pan/archive/",
  "lib/memory/backlog/",
  "lib/memory/adr/",
  "lib/memory/rfc/",
  "lib/memory/postmortems/",
  "lib/memory/research/",
  "lib/memory/runbooks/",
  "lib/memory/smes/",
  "lib/internal/",
  "tests/",
  ".docs/",
]);

/**
 * @param {string[]} argv
 * @returns {{ inputPath: string | null, help: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let inputPath = null;
  let help = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--input") {
      inputPath = argv[i + 1] ?? null;
      i += 1;
    } else if (!arg.startsWith("-") && inputPath == null) {
      inputPath = arg;
    }
  }
  return { inputPath, help };
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
export function loadEvidenceFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  const raw = readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw);
  if (isObject(parsed) && "embedded_example" in parsed) {
    const { embedded_example: _embedded, ...primary } = parsed;
    return primary;
  }
  return parsed;
}

/** @param {string} filePath */
export function loadEmbeddedEvidenceExample(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  const parsed = JSON.parse(readFileSync(abs, "utf8"));
  if (!isObject(parsed) || !isObject(parsed.embedded_example)) {
    throw new Error(`fixture ${filePath} has no embedded_example object.`);
  }
  return parsed.embedded_example;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} artifact
 * @returns {string[]}
 */
export function validateEvidenceStructure(artifact) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(artifact)) {
    return ["artifact MUST be a JSON object."];
  }

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in artifact)) {
      errors.push(`missing required field "${key}".`);
    }
  }

  if (artifact.schema_version !== "1") {
    errors.push('schema_version MUST be "1".');
  }
  if (artifact.artifact_kind !== "greenfield-us9-evidence") {
    errors.push('artifact_kind MUST be "greenfield-us9-evidence".');
  }

  const metadata = artifact.metadata;
  if (!isObject(metadata)) {
    errors.push("metadata MUST be an object.");
  } else {
    for (const key of [
      "feature_id",
      "task_id",
      "target_repo",
      "pipeline_id",
      "captured_at_iso",
      "project_root",
    ]) {
      if (!(key in metadata)) {
        errors.push(`metadata.${key} is required.`);
      }
    }
    if ("project_root" in metadata && !ALLOWED_PROJECT_ROOT.has(metadata.project_root)) {
      errors.push('metadata.project_root MUST be "." or ".pancreator".');
    }
    if (metadata.pipeline_id !== "init-greenfield") {
      errors.push('metadata.pipeline_id MUST be "init-greenfield".');
    }
    const targetRepo = metadata.target_repo;
    if (!isObject(targetRepo) || typeof targetRepo.path !== "string" || targetRepo.path.length === 0) {
      errors.push("metadata.target_repo.path MUST be a non-empty string.");
    }
  }

  const provenance = artifact.provenance;
  if (!isObject(provenance)) {
    errors.push("provenance MUST be an object.");
  } else {
    if (!Array.isArray(provenance.cli_commands) || provenance.cli_commands.length === 0) {
      errors.push("provenance.cli_commands MUST be a non-empty array.");
    }
    if (!Array.isArray(provenance.pipeline_stages_completed)) {
      errors.push("provenance.pipeline_stages_completed MUST be an array.");
    }
  }

  const checklist = artifact.checklist;
  if (!isObject(checklist)) {
    errors.push("checklist MUST be an object.");
  } else {
    for (const key of REQUIRED_CHECKLIST_KEYS) {
      if (!(key in checklist)) {
        errors.push(`checklist.${key} is required.`);
      } else if (typeof checklist[key] !== "boolean") {
        errors.push(`checklist.${key} MUST be a boolean.`);
      }
    }
  }

  const preconditions = artifact.verdict_preconditions;
  if (!isObject(preconditions)) {
    errors.push("verdict_preconditions MUST be an object.");
  } else {
    if (typeof preconditions.minimum_stages_completed !== "number") {
      errors.push("verdict_preconditions.minimum_stages_completed MUST be a number.");
    }
    if (typeof preconditions.required_checklist_pass_count !== "number") {
      errors.push("verdict_preconditions.required_checklist_pass_count MUST be a number.");
    }
  }

  return errors;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function matchDenyListedPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const norm = value.replace(/\\/gu, "/").replace(/^\/+/u, "");
  for (const prefix of DENY_LIST_PREFIXES) {
    if (norm === prefix || norm.startsWith(prefix) || norm.includes(prefix)) {
      return prefix;
    }
  }
  return null;
}

/**
 * @param {unknown} artifact
 * @returns {string[]}
 */
export function validateDenyListedEvidencePaths(artifact) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(artifact)) {
    return errors;
  }
  const metadata = artifact.metadata;
  if (isObject(metadata) && isObject(metadata.target_repo)) {
    const match = matchDenyListedPath(metadata.target_repo.path);
    if (match) {
      errors.push(`metadata.target_repo.path matches deny-listed prefix ${match}.`);
    }
  }
  const provenance = artifact.provenance;
  if (isObject(provenance) && Array.isArray(provenance.cli_commands)) {
    for (const cmd of provenance.cli_commands) {
      const match = matchDenyListedPath(cmd);
      if (match) {
        errors.push(`provenance.cli_commands entry matches deny-listed prefix ${match}.`);
      }
    }
  }
  return errors;
}

/**
 * @param {Record<string, unknown>} artifact
 * @returns {{ passed: string[], failed: string[], gaps: string[] }}
 */
export function evaluateChecklistRules(artifact) {
  /** @type {string[]} */
  const passed = [];
  /** @type {string[]} */
  const failed = [];
  /** @type {string[]} */
  const gaps = [];

  const checklist = /** @type {Record<string, boolean>} */ (artifact.checklist);
  for (const key of REQUIRED_CHECKLIST_KEYS) {
    if (checklist[key] === true) {
      passed.push(key);
    } else {
      gaps.push(key);
    }
  }

  const provenance = /** @type {Record<string, unknown>} */ (artifact.provenance);
  const stages = Array.isArray(provenance.pipeline_stages_completed)
    ? provenance.pipeline_stages_completed
    : [];
  for (const stage of REQUIRED_STAGES) {
    if (stages.includes(stage)) {
      passed.push(`stage:${stage}`);
    } else {
      gaps.push(`stage:${stage}`);
    }
  }

  const preconditions = /** @type {Record<string, number>} */ (
    artifact.verdict_preconditions
  );
  if (stages.length < preconditions.minimum_stages_completed) {
    failed.push(
      `pipeline_stages_completed (${stages.length}) < minimum_stages_completed (${preconditions.minimum_stages_completed}).`,
    );
  }
  if (passed.filter((item) => !item.startsWith("stage:")).length < preconditions.required_checklist_pass_count) {
    failed.push(
      `checklist pass count (${passed.filter((item) => !item.startsWith("stage:")).length}) < required_checklist_pass_count (${preconditions.required_checklist_pass_count}).`,
    );
  }

  return { passed, failed, gaps };
}

/**
 * @param {{ structureErrors: string[], checklist: { passed: string[], failed: string[], gaps: string[] } }} input
 * @returns {typeof VERDICTS[keyof typeof VERDICTS]}
 */
export function computeVerdict(input) {
  if (input.structureErrors.length > 0 || input.checklist.failed.length > 0) {
    return VERDICTS.FAIL;
  }
  if (input.checklist.gaps.length > 0) {
    return VERDICTS.FAIL_WITH_GAPS;
  }
  return VERDICTS.PASS;
}

/**
 * @param {unknown} artifact
 * @returns {{
 *   verdict: string,
 *   structureErrors: string[],
 *   checklist: { passed: string[], failed: string[], gaps: string[] },
 * }}
 */
export function evaluateGreenfieldEvidence(artifact) {
  const structureErrors = [
    ...validateEvidenceStructure(artifact),
    ...validateDenyListedEvidencePaths(artifact),
  ];
  if (structureErrors.length > 0) {
    return {
      verdict: VERDICTS.FAIL,
      structureErrors,
      checklist: { passed: [], failed: [], gaps: [] },
    };
  }
  const checklist = evaluateChecklistRules(/** @type {Record<string, unknown>} */ (artifact));
  const verdict = computeVerdict({ structureErrors, checklist });
  return { verdict, structureErrors, checklist };
}

/**
 * @param {string} filePath
 * @returns {ReturnType<typeof evaluateGreenfieldEvidence> & { inputPath: string }}
 */
export function evaluateGreenfieldEvidenceFile(filePath) {
  const artifact = loadEvidenceFile(filePath);
  const result = evaluateGreenfieldEvidence(artifact);
  return { ...result, inputPath: filePath };
}

function printHelp() {
  console.log(`Usage:
  node lib/internal/tools/checks/evaluate-greenfield-evidence.mjs --input <artifact.json>

Verdicts: pass | fail | fail-with-gaps`);
}

function main() {
  const { inputPath, help } = parseArgs(process.argv);
  if (help || !inputPath) {
    printHelp();
    process.exit(help ? 0 : 2);
  }

  const result = evaluateGreenfieldEvidenceFile(inputPath);
  const payload = {
    input: inputPath,
    verdict: result.verdict,
    structure_errors: result.structureErrors,
    checklist: result.checklist,
  };
  console.log(stringifyRepoJson(payload, REPO_ROOT).trimEnd());
  process.exit(result.verdict === VERDICTS.PASS ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
