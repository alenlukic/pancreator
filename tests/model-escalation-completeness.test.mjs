import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const ESCALATION_REL = "pancreator-model-escalation.yaml";
const PIPELINE_REL = "lib/pipelines/feature-delivery.yaml";
const PERSONA_DIR_REL = "lib/personas";
// Feature-delivery injects design/product sub-stages from this module rather
// than from the base pipeline YAML, so its persona slug literals are part of
// the live persona set the escalation config must cover.
const DESIGN_STEPS_REL =
  "lib/internal/packages/@pancreator/cli/src/design-steps.ts";

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** All persona file stems on disk, used to validate scanned slug literals. */
function personaSlugsOnDisk() {
  return new Set(
    fs
      .readdirSync(path.join(ROOT, PERSONA_DIR_REL), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/u, "")),
  );
}

/**
 * PERSONA.SOME_NAME -> some-name slug normalization, matching the persona file
 * stems and escalation config persona keys.
 * @param {string} key
 */
function personaKeyToSlug(key) {
  return key.replace(/^PERSONA\./u, "").toLowerCase().replace(/_/gu, "-");
}

/**
 * Collect every persona slug the feature-delivery pipeline depends on:
 * stage owners (`persona:`), stage contract owners (`persona_contract:`),
 * remediation owners (`default_owner` / `plan_invalidating_owner`), and the
 * design/product sub-stage personas injected from design-steps.ts.
 * @returns {Set<string>}
 */
function pipelinePersonaSlugs() {
  const yaml = read(PIPELINE_REL);
  /** @type {Set<string>} */
  const slugs = new Set();
  for (const m of yaml.matchAll(/^\s*persona:\s*([a-z][a-z0-9-]*)\s*$/gmu)) {
    slugs.add(m[1]);
  }
  for (const m of yaml.matchAll(
    /(?:persona_contract|default_owner|plan_invalidating_owner):\s*(PERSONA\.[A-Z0-9_]+)/gu,
  )) {
    slugs.add(personaKeyToSlug(m[1]));
  }
  // Sub-stage personas referenced by slug literal in the design-steps module.
  const onDisk = personaSlugsOnDisk();
  let designSteps = "";
  try {
    designSteps = read(DESIGN_STEPS_REL);
  } catch {
    designSteps = "";
  }
  for (const m of designSteps.matchAll(/["'`]([a-z][a-z0-9-]+)["'`]/gu)) {
    if (onDisk.has(m[1])) {
      slugs.add(m[1]);
    }
  }
  return slugs;
}

/**
 * Parse `configs.<name>.personas.<slug>` from the escalation YAML without a
 * YAML dependency. Returns a map of config-name -> Set(persona slug).
 * @returns {Map<string, Set<string>>}
 */
function escalationConfigPersonas() {
  const lines = read(ESCALATION_REL).split(/\r?\n/u);
  /** @type {Map<string, Set<string>>} */
  const configs = new Map();
  let activeConfig = null;
  let inPersonas = false;
  let personasIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\t/gu, "  ");
    if (/^\s*#/u.test(line) || line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;

    const cfg = /^ {2}([a-z][a-z0-9-]*):\s*$/u.exec(line);
    if (cfg && indent === 2) {
      activeConfig = cfg[1];
      configs.set(activeConfig, new Set());
      inPersonas = false;
      continue;
    }
    if (/^\s{4}personas:\s*$/u.test(line)) {
      inPersonas = true;
      personasIndent = indent;
      continue;
    }
    if (inPersonas) {
      if (indent <= personasIndent) {
        inPersonas = false;
      } else {
        const persona = /^\s+([a-z][a-z0-9-]*):\s*$/u.exec(line);
        if (persona && indent === personasIndent + 2 && activeConfig) {
          configs.get(activeConfig)?.add(persona[1]);
        }
      }
    }
  }
  return configs;
}

test("escalation config defines at least one named config with personas", () => {
  const configs = escalationConfigPersonas();
  assert.ok(configs.size > 0, "escalation YAML MUST define configs");
  for (const [name, personas] of configs) {
    assert.ok(
      personas.size > 0,
      `escalation config '${name}' MUST declare persona tier maps`,
    );
  }
});

test("every feature-delivery pipeline persona resolves in EVERY escalation config", () => {
  const required = pipelinePersonaSlugs();
  assert.ok(
    required.size >= 5,
    `expected the pipeline to reference several personas, found ${required.size}`,
  );
  const configs = escalationConfigPersonas();
  /** @type {string[]} */
  const problems = [];
  for (const [configName, personas] of configs) {
    for (const slug of required) {
      if (!personas.has(slug)) {
        problems.push(
          `config '${configName}' is missing persona '${slug}' (referenced by feature-delivery.yaml)`,
        );
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `escalation config is incomplete vs the pipeline persona set:\n  ${problems.join("\n  ")}`,
  );
});

test("design-engineer and design-reviewer specifically resolve (regression guard)", () => {
  // These two personas produced the bulk of historical
  // 'Persona missing from escalation config' WARN noise in run logs.
  const configs = escalationConfigPersonas();
  for (const [configName, personas] of configs) {
    for (const slug of ["design-engineer", "design-reviewer"]) {
      assert.ok(
        personas.has(slug),
        `config '${configName}' MUST include '${slug}'`,
      );
    }
  }
});
