import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAN_BIN = path.join(
  ROOT,
  "pancreator/lib/internal/packages/@pancreator/cli/bin/pan.js",
);

function ensureCursorProjections() {
  const result = spawnSync(process.execPath, [PAN_BIN, "cursor-sync"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

ensureCursorProjections();

const AGENTS_DIR = path.join(ROOT, ".cursor", "agents");
const REBASE_PATH_PREFIXES = [
  "pancreator/",
  "AGENTS.md",
  "OPERATION.md",
  "pancreator.yaml",
  "lib/",
  ".pan/",
  ".docs/",
  "tests/",
  ".cursor/",
];

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * @param {string} raw
 * @returns {{ frontmatter: string; body: string }}
 */
export function splitAgentProjection(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(raw);
  assert.ok(match, "projection must have YAML frontmatter");
  return { frontmatter: match[1], body: match[2] };
}

/** @param {string} body */
export function firstRetrievalStep(body) {
  return retrievalSteps(body)[0];
}

/** @param {string} body */
export function retrievalSteps(body) {
  const section = body.match(
    /## Retrieval contract\r?\n\r?\n([\s\S]*?)(?:\r?\n\r?\n## |\r?\n$)/u,
  );
  assert.ok(section, "projection must declare a retrieval contract section");
  const steps = section[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^\d+\./u.test(line));
  assert.ok(steps.length > 0, "retrieval contract must contain numbered steps");
  return steps;
}

/** @param {string} frontmatter */
export function frontmatterHasKey(frontmatter, key) {
  return new RegExp(`^${key}:`, "mu").test(frontmatter);
}

function readProjectRootRel() {
  const cfg = read("pancreator/pancreator.yaml");
  const match = cfg.match(/^project_root:\s*["']?(.+?)["']?\s*$/mu);
  assert.ok(match, "pancreator/pancreator.yaml must declare project_root");
  return match[1];
}

/**
 * @param {string} raw
 * @param {string} projectPrefix
 */
function rebaseProjectionPaths(raw, projectPrefix) {
  if (projectPrefix === ".") {
    return raw;
  }
  const escapedPrefix = projectPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let rewritten = raw;
  for (const token of REBASE_PATH_PREFIXES) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenReplacement =
      token === "pancreator/" ? `${projectPrefix}/` : `${projectPrefix}/${token}`;
    const slashTokenReplacement =
      token === "pancreator/" ? `/${projectPrefix}/` : `/${projectPrefix}/${token}`;
    const tokenRegex = new RegExp(
      `(^|[\\s\\t\\r\\n\`"'([{<>=,;:])${escapedToken}`,
      "gmu",
    );
    rewritten = rewritten.replace(tokenRegex, `$1${tokenReplacement}`);
    const slashTokenRegex = new RegExp(
      `(^|[\\s\\t\\r\\n\`"'([{<>=,;:])/${escapedToken}`,
      "gmu",
    );
    rewritten = rewritten.replace(slashTokenRegex, `$1${slashTokenReplacement}`);
  }
  const dedupeRegex = new RegExp(`/${escapedPrefix}/${escapedPrefix}/`, "g");
  rewritten = rewritten.replace(dedupeRegex, `/${projectPrefix}/`);
  const dedupeNoLeadingSlash = new RegExp(`${escapedPrefix}/${escapedPrefix}/`, "g");
  rewritten = rewritten.replace(dedupeNoLeadingSlash, `${projectPrefix}/`);
  return rewritten;
}

const SOURCE_BACKED = fs
  .readdirSync(AGENTS_DIR)
  .filter((name) => name.endsWith(".md") && name !== "general-purpose.md")
  .map((name) => name.replace(/\.md$/u, ""));
const PROJECT_ROOT_REL = readProjectRootRel();

test("source-backed Cursor projections mirror persona specs with path rebasing only", () => {
  for (const persona of SOURCE_BACKED) {
    const sourceRel = path.posix.join(
      PROJECT_ROOT_REL,
      "lib/personas",
      `${persona}.md`,
    );
    const source = read(sourceRel);
    const projection = read(path.posix.join(".cursor/agents", `${persona}.md`));
    const expected = rebaseProjectionPaths(source, PROJECT_ROOT_REL);
    assert.equal(projection, expected, persona);
  }
});

test("source-backed Cursor projections preserve full persona frontmatter", () => {
  for (const persona of SOURCE_BACKED) {
    const { frontmatter, body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", `${persona}.md`)),
    );
    assert.equal(frontmatterHasKey(frontmatter, "tools"), true, persona);
    assert.equal(frontmatterHasKey(frontmatter, "disallowedTools"), true, persona);
    assert.equal(frontmatterHasKey(frontmatter, "metadata"), true, persona);
    assert.match(body, /## Static execution contract/u, persona);
    assert.match(body, /RTK-first retrieval/u, persona);
  }
});

test("general-purpose remains standalone generated projection", () => {
  const { frontmatter, body } = splitAgentProjection(read(".cursor/agents/general-purpose.md"));
  assert.equal(frontmatterHasKey(frontmatter, "tools"), true);
  assert.equal(frontmatterHasKey(frontmatter, "disallowedTools"), true);
  assert.equal(frontmatterHasKey(frontmatter, "metadata"), true);
  assert.match(frontmatter, /pancreator-model-tier:\s*standalone/u);
  assert.match(body, /## Retrieval contract/u);
});
