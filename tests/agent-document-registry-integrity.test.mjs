import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY_REL = "lib/memory/handbook/agent-document-registry.md";
const PERSONA_DIR_REL = "lib/personas";

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** @param {string} rel */
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/**
 * Parse the registry markdown tables into a key -> path map.
 * Rows look like: | `DOC.KEY` | `path/to/file` | binding use |
 * Persona rows may omit the third column.
 * @param {string} md
 * @returns {Map<string, string>}
 */
function parseRegistry(md) {
  /** @type {Map<string, string>} */
  const keys = new Map();
  const rowRe =
    /^\|\s*`(DOC\.[A-Z0-9_]+|PIPE\.[A-Z0-9_]+|PERSONA\.[A-Z0-9_]+)`\s*\|\s*`([^`]+)`\s*\|/u;
  for (const line of md.split(/\r?\n/u)) {
    const m = rowRe.exec(line.trim());
    if (m) {
      keys.set(m[1], m[2].trim());
    }
  }
  return keys;
}

/**
 * Extract the YAML frontmatter block (between the first pair of --- fences).
 * @param {string} raw
 */
function frontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(raw);
  return m ? m[1] : "";
}

/** @param {string} body */
function listPersonaFiles() {
  const dir = path.join(ROOT, PERSONA_DIR_REL);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

const registryMd = read(REGISTRY_REL);
const registry = parseRegistry(registryMd);

test("registry resolves at least the core, pipeline, and persona keys", () => {
  assert.ok(
    registry.has("DOC.AGENTS"),
    "registry MUST define DOC.AGENTS",
  );
  assert.ok(
    registry.has("DOC.REGISTRY"),
    "registry MUST define DOC.REGISTRY (self key)",
  );
  assert.ok(
    registry.has("PIPE.FEATURE_DELIVERY"),
    "registry MUST define PIPE.FEATURE_DELIVERY",
  );
  const personaKeys = [...registry.keys()].filter((k) =>
    k.startsWith("PERSONA."),
  );
  assert.ok(
    personaKeys.length >= 10,
    `registry MUST enumerate persona keys, found ${personaKeys.length}`,
  );
});

test("every registry key resolves to an existing repo path", () => {
  /** @type {string[]} */
  const missing = [];
  for (const [key, rel] of registry) {
    if (!exists(rel)) {
      missing.push(`${key} -> ${rel}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `registry keys point at missing files:\n  ${missing.join("\n  ")}`,
  );
});

test("AGENTS.md only names keys that the registry defines", () => {
  const agents = read("AGENTS.md");
  const referenced = new Set();
  const keyRe = /`(DOC\.[A-Z0-9_]+|PIPE\.[A-Z0-9_]+|PERSONA\.[A-Z0-9_]+)`/gu;
  let m;
  while ((m = keyRe.exec(agents)) !== null) {
    referenced.add(m[1]);
  }
  const unknown = [...referenced].filter((k) => !registry.has(k)).sort();
  assert.deepEqual(
    unknown,
    [],
    `AGENTS.md references keys absent from DOC.REGISTRY: ${unknown.join(", ")}`,
  );
});

test("PERSONA.* registry entries and lib/personas/*.md are in bijection", () => {
  const registryPersonaPaths = new Set(
    [...registry.entries()]
      .filter(([k]) => k.startsWith("PERSONA."))
      .map(([, rel]) => rel),
  );
  const onDisk = new Set(
    listPersonaFiles().map((name) => `${PERSONA_DIR_REL}/${name}`),
  );
  const missingFromRegistry = [...onDisk].filter(
    (p) => !registryPersonaPaths.has(p),
  );
  const danglingInRegistry = [...registryPersonaPaths].filter(
    (p) => !onDisk.has(p),
  );
  assert.deepEqual(
    missingFromRegistry,
    [],
    `personas on disk missing a PERSONA.* registry key: ${missingFromRegistry.join(", ")}`,
  );
  assert.deepEqual(
    danglingInRegistry,
    [],
    `PERSONA.* registry keys with no persona file: ${danglingInRegistry.join(", ")}`,
  );
});

test("every persona declares the required static-contract frontmatter", () => {
  /** @type {string[]} */
  const problems = [];
  for (const name of listPersonaFiles()) {
    const rel = `${PERSONA_DIR_REL}/${name}`;
    const fm = frontmatter(read(rel));
    if (!/pancreator-contract-key:\s*PERSONA\.[A-Z0-9_]+/u.test(fm)) {
      problems.push(`${name}: missing pancreator-contract-key`);
    }
    if (!/pancreator-required-docs:\s*\r?\n\s*-\s*[A-Z]/u.test(fm)) {
      problems.push(`${name}: missing/empty pancreator-required-docs`);
    }
    if (!/pancreator-output-manifest:\s*required/u.test(fm)) {
      problems.push(`${name}: pancreator-output-manifest must be 'required'`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every persona body owns a complete ## Static execution contract", () => {
  const REQUIRED_SUBSECTIONS = [
    "### Required context",
    "### Responsibilities",
    "### Definition of done",
    "### Output manifest",
    "### Gate validator",
  ];
  /** @type {string[]} */
  const problems = [];
  for (const name of listPersonaFiles()) {
    const body = read(`${PERSONA_DIR_REL}/${name}`);
    if (!/^##\s+Static execution contract\b/mu.test(body)) {
      problems.push(`${name}: missing '## Static execution contract' section`);
      continue;
    }
    for (const sub of REQUIRED_SUBSECTIONS) {
      if (!body.includes(sub)) {
        problems.push(`${name}: missing '${sub}' subsection`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every DOC.*/PIPE.* key a persona requires resolves in the registry", () => {
  /** @type {string[]} */
  const problems = [];
  for (const name of listPersonaFiles()) {
    const fm = frontmatter(read(`${PERSONA_DIR_REL}/${name}`));
    const block = /pancreator-required-docs:\s*\r?\n((?:\s*-\s*[^\n]+\r?\n?)+)/u.exec(
      fm,
    );
    if (!block) continue;
    const declared = [...block[1].matchAll(/-\s*([A-Z][A-Z0-9_.]+)/gu)].map(
      (m) => m[1],
    );
    for (const key of declared) {
      if (!registry.has(key)) {
        problems.push(`${name}: required doc ${key} is not in DOC.REGISTRY`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("the deleted persona-execution-contract is not referenced anywhere live", () => {
  // Guards against reintroducing the superseded contract path that the
  // registry/persona-contracts split replaced.
  assert.equal(
    exists("lib/memory/handbook/persona-execution-contract.md"),
    false,
    "persona-execution-contract.md was superseded by persona-contracts.md and must stay deleted",
  );
  assert.doesNotMatch(
    read("AGENTS.md"),
    /persona-execution-contract/u,
    "AGENTS.md must not reference the superseded persona-execution-contract.md",
  );
  assert.doesNotMatch(
    registryMd,
    /persona-execution-contract/u,
    "registry must not reference the superseded persona-execution-contract.md",
  );
});
