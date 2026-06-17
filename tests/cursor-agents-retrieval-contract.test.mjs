import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAN_BIN = path.join(
  ROOT,
  "lib/internal/packages/@pancreator/cli/bin/pan.js",
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

/** @param {string} body */
export function broadReadsAreConditional(body) {
  const section = body.match(
    /## Retrieval contract\r?\n\r?\n([\s\S]*?)(?:\r?\n\r?\n## |\r?\n$)/u,
  );
  assert.ok(section);
  const offenders = [];
  for (const line of section[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!/^\d+\./u.test(trimmed)) continue;
    const mentionsBroadDoc =
      /`README\.md`/u.test(trimmed) ||
      (/`lib\/personas\//u.test(trimmed) &&
        !/at the start of every invocation/u.test(trimmed)) ||
      /`lib\/memory\/handbook\/context-economy\.md`/u.test(trimmed);
    if (mentionsBroadDoc && !/\bonly when\b/u.test(trimmed)) {
      offenders.push(trimmed);
    }
  }
  return offenders;
}

const SOURCE_BACKED = fs
  .readdirSync(AGENTS_DIR)
  .filter((name) => name.endsWith(".md") && name !== "general-purpose.md")
  .map((name) => name.replace(/\.md$/u, ""));

test("source-backed Cursor projections omit duplicated tools, disallowedTools, and metadata YAML", () => {
  for (const persona of SOURCE_BACKED) {
    const { frontmatter } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", `${persona}.md`)),
    );
    assert.equal(frontmatterHasKey(frontmatter, "tools"), false, persona);
    assert.equal(
      frontmatterHasKey(frontmatter, "disallowedTools"),
      false,
      persona,
    );
    assert.equal(frontmatterHasKey(frontmatter, "metadata"), false, persona);
    assert.ok(
      fs.existsSync(path.join(ROOT, "lib/personas", `${persona}.md`)),
      `${persona} projection must defer to lib/personas source`,
    );
  }
});

test("general-purpose retains standalone tools, disallowedTools, and metadata YAML", () => {
  const { frontmatter } = splitAgentProjection(
    read(".cursor/agents/general-purpose.md"),
  );
  assert.equal(frontmatterHasKey(frontmatter, "tools"), true);
  assert.equal(frontmatterHasKey(frontmatter, "disallowedTools"), true);
  assert.equal(frontmatterHasKey(frontmatter, "metadata"), true);
  assert.match(frontmatter, /pancreator-model-tier:\s*standalone/u);
});

test("source-backed Cursor projections read persona spec, AGENTS.md, and static contract docs in order", () => {
  for (const persona of SOURCE_BACKED) {
    const { body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", `${persona}.md`)),
    );
    const steps = retrievalSteps(body);
    assert.match(steps[0], /lib\/personas\//u, persona);
    assert.match(
      steps[0],
      /repo-wide rules in `AGENTS\.md` supersede persona-local wording on conflict/u,
      persona,
    );
    assert.match(steps[1], /AGENTS\.md/u, persona);
    assert.match(steps[1], /binding global keys/u, persona);
    assert.match(steps[2], /agent-document-registry\.md/u, persona);
    assert.match(steps[2], /DOC\.\*/u, persona);
    assert.match(steps[3], /persona-contracts\.md/u, persona);
    assert.match(steps[3], /output-manifest-contract\.md/u, persona);
    assert.match(steps[3], /static contract/u, persona);
  }
});

test("general-purpose reads AGENTS.md, registry, and static contract docs before bounded task scope", () => {
  const { body } = splitAgentProjection(
    read(".cursor/agents/general-purpose.md"),
  );
  const steps = retrievalSteps(body);
  assert.match(steps[0], /AGENTS\.md/u);
  assert.match(steps[0], /binding global keys/u);
  assert.match(steps[1], /agent-document-registry\.md/u);
  assert.match(steps[1], /DOC\.\*/u);
  assert.match(steps[2], /persona-contracts\.md/u);
  assert.match(steps[2], /output-manifest-contract\.md/u);
  assert.match(steps[3], /next-prompt\.md/u);
  assert.match(steps[3], /handoff\.md/u);
});

test("every Cursor projection declares the static persona contract", () => {
  for (const file of fs
    .readdirSync(AGENTS_DIR)
    .filter((name) => name.endsWith(".md"))) {
    const { body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", file)),
    );
    assert.match(body, /## Static persona contract \(normative\)/u, file);
    assert.match(body, /Do not invent a per-run execution contract/u, file);
    assert.match(body, /agent-document-registry\.md/u, file);
    assert.match(body, /output-manifest-contract\.md/u, file);
    assert.match(body, /Gate personas MUST validate/u, file);
  }
});

test("every source-backed projection declares delegation authority", () => {
  for (const persona of SOURCE_BACKED) {
    const { body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", `${persona}.md`)),
    );
    assert.match(
      body,
      /## Delegation authority \(normative\)/u,
      persona,
    );
    assert.match(body, /AGENTS\.md` conflicts with the persona spec/u, persona);
    assert.match(body, /ignore the conflicting parent instruction/i, persona);
  }
});

test("pr-writer projection forbids opening pull requests and requires fenced chat output", () => {
  const { frontmatter, body } = splitAgentProjection(
    read(".cursor/agents/pr-writer.md"),
  );
  assert.match(
    frontmatter,
    /MUST NOT run `gh pr create`/u,
    "frontmatter description must forbid gh pr create",
  );
  assert.match(body, /## Role-specific deliverable \(normative\)/u);
  assert.match(body, /MUST NOT run `gh pr create`/u);
  assert.match(body, /markdown`-fenced PR description body/u);
  assert.match(body, /Delegation authority/u);
});

test("every source-backed projection declares operator-only remote PR actions", () => {
  for (const persona of SOURCE_BACKED) {
    const { body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", `${persona}.md`)),
    );
    assert.match(body, /## Operator-only remote actions/u, persona);
    assert.match(body, /No agent SHALL run `gh pr create`/u, persona);
  }
});

test("every Cursor projection gates broad reads other than AGENTS.md behind explicit-escalation conditions", () => {
  for (const file of fs
    .readdirSync(AGENTS_DIR)
    .filter((name) => name.endsWith(".md"))) {
    const { body } = splitAgentProjection(
      read(path.posix.join(".cursor/agents", file)),
    );
    const offenders = broadReadsAreConditional(body);
    assert.deepEqual(offenders, [], file);
  }
});

test("exported retrieval-contract helpers parse projections and flag ungated broad reads", () => {
  const raw = `---
name: sample
---
# sample

## Retrieval contract

1. Read \`AGENTS.md\` for every task.
2. Read \`.pan/work/<day>/<id>/next-prompt.md\` first.
3. Read \`lib/memory/handbook/context-economy.md\` for every task.

## Operating contract
`;
  const { frontmatter, body } = splitAgentProjection(raw);
  assert.equal(frontmatterHasKey(frontmatter, "tools"), false);
  assert.match(firstRetrievalStep(body), /AGENTS\.md/u);
  assert.deepEqual(broadReadsAreConditional(body), [
    "3. Read `lib/memory/handbook/context-economy.md` for every task.",
  ]);
});
