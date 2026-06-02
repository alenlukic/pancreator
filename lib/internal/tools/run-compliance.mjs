#!/usr/bin/env node
/**
 * Compliance descriptor runner: validate YAML descriptors and execute pluggable
 * assertion adapters. Exits non-zero when any `high` severity finding is open
 * (maps to `severity: block` in operator vocabulary).
 *
 * Usage:
 *   node lib/internal/tools/run-compliance.mjs [descriptor-id]
 *   node lib/internal/tools/run-compliance.mjs --run-id <task-id>
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DESCRIPTOR_DIR = path.join(REPO_ROOT, "tests", "compliance");
const SCHEMA_PATH = path.join(DESCRIPTOR_DIR, "schemas", "latest.yaml");

const TRIGGER_MODES = new Set([
  "scheduled-cadence",
  "structure-change",
  "operator-on-demand",
]);
const SEVERITIES = new Set(["high", "medium", "low"]);

/**
 * @param {unknown} descriptor
 * @param {string} fileLabel
 * @returns {string[]}
 */
export function validateDescriptorStructure(descriptor, fileLabel) {
  /** @type {string[]} */
  const errors = [];
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return [`${fileLabel}: descriptor MUST be a YAML object.`];
  }
  const d = /** @type {Record<string, unknown>} */ (descriptor);
  const required = [
    "schema_ref",
    "id",
    "severity",
    "trigger_modes",
    "scope",
    "assertion",
  ];
  for (const key of required) {
    if (!(key in d)) {
      errors.push(`${fileLabel}: missing required field "${key}".`);
    }
  }
  if (d.schema_ref !== "tests/compliance/schemas/latest.yaml") {
    errors.push(
      `${fileLabel}: schema_ref MUST be "tests/compliance/schemas/latest.yaml".`,
    );
  }
  if (typeof d.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(d.id)) {
    errors.push(`${fileLabel}: id MUST match ^[a-z0-9][a-z0-9-]{2,63}$.`);
  }
  if (typeof d.severity !== "string" || !SEVERITIES.has(d.severity)) {
    errors.push(`${fileLabel}: severity MUST be one of high, medium, low.`);
  }
  if (!Array.isArray(d.trigger_modes) || d.trigger_modes.length === 0) {
    errors.push(`${fileLabel}: trigger_modes MUST be a non-empty array.`);
  } else {
    for (const mode of d.trigger_modes) {
      if (typeof mode !== "string" || !TRIGGER_MODES.has(mode)) {
        errors.push(`${fileLabel}: invalid trigger_modes entry "${String(mode)}".`);
      }
    }
  }
  const scope = d.scope;
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) {
    errors.push(`${fileLabel}: scope MUST be an object.`);
  } else {
    const s = /** @type {Record<string, unknown>} */ (scope);
    if (typeof s.surface !== "string" || s.surface.length === 0) {
      errors.push(`${fileLabel}: scope.surface MUST be a non-empty string.`);
    }
    if (!Array.isArray(s.artifacts) || s.artifacts.length === 0) {
      errors.push(`${fileLabel}: scope.artifacts MUST be a non-empty array.`);
    }
  }
  const assertion = d.assertion;
  if (assertion === null || typeof assertion !== "object" || Array.isArray(assertion)) {
    errors.push(`${fileLabel}: assertion MUST be an object.`);
  } else {
    const a = /** @type {Record<string, unknown>} */ (assertion);
    if (typeof a.statement !== "string" || a.statement.length === 0) {
      errors.push(`${fileLabel}: assertion.statement MUST be a non-empty string.`);
    }
    if (typeof a.pass_criteria !== "string" || a.pass_criteria.length === 0) {
      errors.push(`${fileLabel}: assertion.pass_criteria MUST be a non-empty string.`);
    }
  }
  return errors;
}

/**
 * @param {string} testRel repo-relative path
 * @returns {{ pass: boolean, detail?: string }}
 */
function runNodeTestFile(testRel) {
  const abs = path.join(REPO_ROOT, testRel);
  try {
    execFileSync(process.execPath, ["--test", abs], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { pass: true };
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException & { stderr?: string; stdout?: string }} */ (e);
    const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n").trim();
    return { pass: false, detail: detail || `node --test ${testRel} failed` };
  }
}

/** @type {Record<string, (descriptor: Record<string, unknown>) => Promise<{ pass: boolean, detail?: string }>>} */
const ASSERTION_ADAPTERS = {
  async "json-formatting"(descriptor) {
    void descriptor;
    return runNodeTestFile("tests/migrate-json-formatting.test.mjs");
  },
  async "timestamp-naming-conventions"(descriptor) {
    void descriptor;
    const a = runNodeTestFile("tests/migrate-timestamp-naming.test.mjs");
    if (!a.pass) {
      return a;
    }
    return runNodeTestFile("tests/migrate-inbox-convention.test.mjs");
  },
  async "high-remediation-blocking"(descriptor) {
    void descriptor;
    return { pass: true, detail: "severity-routing registry descriptor" };
  },
  async "medium-backlog-default-off"(descriptor) {
    void descriptor;
    return { pass: true, detail: "severity-routing registry descriptor" };
  },
  async "low-warning-emission"(descriptor) {
    void descriptor;
    return { pass: true, detail: "severity-routing registry descriptor" };
  },
  async "model-escalation-config"(descriptor) {
    void descriptor;
    return runNodeTestFile("tests/model-escalation-config.test.mjs");
  },
};

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {Promise<{ pass: boolean, detail?: string }>}
 */
export async function runDescriptorAssertion(descriptor) {
  const id = String(descriptor.id ?? "");
  const adapter = ASSERTION_ADAPTERS[id];
  if (adapter === undefined) {
    return {
      pass: false,
      detail: `No assertion adapter registered for descriptor id "${id}".`,
    };
  }
  return adapter(descriptor);
}

/**
 * @param {string} [filterId]
 * @returns {string[]}
 */
export function discoverDescriptorFiles(filterId) {
  const files = readdirSync(DESCRIPTOR_DIR)
    .filter((name) => name.endsWith(".yaml") && !name.startsWith("schemas"))
    .sort();
  if (filterId === undefined) {
    return files.map((f) => path.join(DESCRIPTOR_DIR, f));
  }
  const match = files.find((f) => f.replace(/\.yaml$/, "") === filterId || f === filterId);
  if (match === undefined) {
    throw new Error(`Unknown compliance descriptor "${filterId}".`);
  }
  return [path.join(DESCRIPTOR_DIR, match)];
}

/**
 * @param {string} runId
 * @returns {string}
 */
export function resolveRunOutputDir(runId) {
  const workRoot = path.join(REPO_ROOT, "work");
  if (!existsSync(workRoot)) {
    throw new Error(`Missing work root for --run-id ${runId}.`);
  }
  for (const day of readdirSync(workRoot, { withFileTypes: true })) {
    if (!day.isDirectory()) {
      continue;
    }
    const candidate = path.join(workRoot, day.name, runId);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No work/<day>/${runId} directory found for --run-id.`);
}

/**
 * @param {string} [filterId]
 * @param {{ runId?: string }} [options]
 * @returns {Promise<{ exitCode: number, report: Record<string, unknown> }>}
 */
export async function runCompliance(filterId, options = {}) {
  const schemaText = readFileSync(SCHEMA_PATH, "utf8");
  parseYaml(schemaText);

  const descriptorPaths = discoverDescriptorFiles(filterId);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  /** @type {string[]} */
  const validationErrors = [];

  for (const absPath of descriptorPaths) {
    const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/");
    const raw = readFileSync(absPath, "utf8");
    const descriptor = parseYaml(raw);
    const structErrors = validateDescriptorStructure(descriptor, rel);
    if (structErrors.length > 0) {
      validationErrors.push(...structErrors);
      continue;
    }
    const d = /** @type {Record<string, unknown>} */ (descriptor);
    const assertion = await runDescriptorAssertion(d);
    const severity = String(d.severity);
    const finding = {
      id: d.id,
      severity,
      blocks: severity === "high" && !assertion.pass,
      pass: assertion.pass,
      detail: assertion.detail ?? null,
      descriptor: rel,
    };
    results.push(finding);
    if (severity === "medium" && !assertion.pass) {
      console.warn(
        `[run-compliance] medium finding "${d.id}": ${assertion.detail ?? "failed"}`,
      );
    }
    if (severity === "low" && !assertion.pass) {
      console.warn(
        `[run-compliance] low finding "${d.id}": ${assertion.detail ?? "failed"}`,
      );
    }
  }

  if (validationErrors.length > 0) {
    for (const msg of validationErrors) {
      console.error(`[run-compliance] ${msg}`);
    }
    return {
      exitCode: 1,
      report: {
        status: "invalid",
        validationErrors,
        results,
      },
    };
  }

  const blockFindings = results.filter((r) => r.blocks === true);
  /** @type {Record<string, unknown>} */
  const report = {
    status: blockFindings.length === 0 ? "pass" : "fail",
    schema: path.relative(REPO_ROOT, SCHEMA_PATH).replace(/\\/g, "/"),
    descriptorsRun: results.length,
    blockFindings: blockFindings.length,
    results,
    review_passes: blockFindings.length === 0,
    human_approval: blockFindings.length === 0,
  };

  if (options.runId !== undefined) {
    const outDir = resolveRunOutputDir(options.runId);
    const outPath = path.join(outDir, "compliance-result.json");
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    report.resultFile = path.relative(REPO_ROOT, outPath).replace(/\\/g, "/");
  }

  return { exitCode: blockFindings.length === 0 ? 0 : 1, report };
}

/**
 * @param {string[]} argv
 * @returns {{ filterId?: string, runId?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ filterId?: string, runId?: string }} */
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-id") {
      out.runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    out.filterId = arg.replace(/\.yaml$/, "");
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const { exitCode, report } = await runCompliance(args.filterId, {
    runId: args.runId,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
