import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyPath,
  digestContentHash,
  matchesGlobPattern,
  parseRefreshArgs,
  refreshCitationBody,
  refreshCitations,
} from "../lib/internal/tools/format/refresh-citations.mjs";
import { legacyPrettyJson } from "./helpers/legacy-json-stringify.mjs";

function makeTempRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "refresh-citations-"));
  process.env.PAN_JSON_FORMAT_ABBREV_LEN = "7";
  return root;
}

test("classifyPath refuses inbox notes and warns on immutable inbox queues", () => {
  assert.equal(classifyPath("lib/inbox/notes/draft.md").refuse, true);
  assert.match(classifyPath("lib/inbox/in/foo.md").warn ?? "", /immutable inbox/);
});

test("refreshCitationBody patches flattened YAML frontmatter reference strings", () => {
  const root = makeTempRepo();
  const targetRel = ".docs/flat-target.md";
  mkdirSync(path.dirname(path.join(root, targetRel)), { recursive: true });
  writeFileSync(path.join(root, targetRel), "hello\n", "utf8");
  const citation = JSON.stringify({
    kind: "lines",
    path: targetRel,
    range: [1, 1],
    contentHash: "TBD-on-commit",
  });
  const body = ["---", "references:", `  - '${citation}'`, "...", ""].join("\n");
  const { body: out, changed } = refreshCitationBody(body, 7, root);
  assert.equal(changed, true);
  assert.doesNotMatch(out, /TBD-on-commit/);
  assert.match(out, /contentHash":"[0-9a-f]{7}/);
});

test("refreshCitationBody patches YAML frontmatter references", () => {
  const root = makeTempRepo();
  const targetRel = ".docs/target.md";
  mkdirSync(path.dirname(path.join(root, targetRel)), { recursive: true });
  writeFileSync(path.join(root, targetRel), "hello\n", "utf8");
  const body = [
    "---",
    "references:",
    "  - kind: lines",
    `    path: ${targetRel}`,
    "    range: [1, 1]",
    "    contentHash: TBD-on-commit",
    "---",
    "",
  ].join("\n");
  const { body: out, changed } = refreshCitationBody(body, 7, root);
  assert.equal(changed, true);
  assert.doesNotMatch(out, /TBD-on-commit/);
  assert.match(out, /contentHash: [0-9a-f]{7}/);
});

test("refreshCitationBody patches Markdown fenced JSON citations", () => {
  const root = makeTempRepo();
  const targetRel = ".docs/json-target.md";
  mkdirSync(path.dirname(path.join(root, targetRel)), { recursive: true });
  writeFileSync(path.join(root, targetRel), "payload\n", "utf8");
  const body = [
    "Example:",
    "",
    "```json",
    "{",
    '  "kind": "lines",',
    `  "path": "${targetRel}",`,
    '  "range": [1, 1],',
    '  "contentHash": "TBD-on-commit"',
    "}",
    "```",
    "",
  ].join("\n");
  const { body: out, changed } = refreshCitationBody(body, 7, root);
  assert.equal(changed, true);
  assert.doesNotMatch(out, /TBD-on-commit/);
});

test("refreshCitationBody patches standalone JSON bodies", () => {
  const root = makeTempRepo();
  const targetRel = ".docs/standalone-target.md";
  mkdirSync(path.dirname(path.join(root, targetRel)), { recursive: true });
  writeFileSync(path.join(root, targetRel), "json-body\n", "utf8");
  const body = legacyPrettyJson({
    kind: "lines",
    path: targetRel,
    range: [1, 1],
    contentHash: "TBD-on-commit",
  });
  const { body: out, changed } = refreshCitationBody(body, 7, root);
  assert.equal(changed, true);
  assert.doesNotMatch(out, /TBD-on-commit/);
});

test("refreshCitations is idempotent on second invocation", () => {
  const root = makeTempRepo();
  const rel = "sample.md";
  const targetRel = "target.md";
  writeFileSync(path.join(root, targetRel), "stable\n", "utf8");
  writeFileSync(
    path.join(root, rel),
    [
      "---",
      "references:",
      "  - kind: lines",
      `    path: ${targetRel}`,
      "    range: [1, 1]",
      "    contentHash: TBD-on-commit",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
  const first = refreshCitations({ repoRoot: root, globs: [rel] });
  assert.equal(first.filesChanged, 1);
  const second = refreshCitations({ repoRoot: root, globs: [rel] });
  assert.equal(second.filesChanged, 0);
});

test("refreshCitations refuses lib/inbox/notes paths", () => {
  const root = makeTempRepo();
  mkdirSync(path.join(root, "lib/inbox/notes"), { recursive: true });
  const rel = "lib/inbox/notes/secret.md";
  writeFileSync(
    path.join(root, rel),
    "contentHash: TBD-on-commit\n",
    "utf8",
  );
  assert.throws(
    () => refreshCitations({ repoRoot: root, globs: [rel] }),
    /Refusing to write paths under lib\/inbox\/notes\//,
  );
});

test("parseRefreshArgs recognizes --dry-run and globs", () => {
  const parsed = parseRefreshArgs([
    "node",
    "refresh-citations.mjs",
    "--dry-run",
    "lib/memory/**/*.md",
  ]);
  assert.equal(parsed.dryRun, true);
  assert.deepEqual(parsed.globs, ["lib/memory/**/*.md"]);
});

test("matchesGlobPattern supports single-segment wildcards", () => {
  assert.equal(matchesGlobPattern("lib/memory/*.md", "lib/memory/current.md"), true);
  assert.equal(matchesGlobPattern("lib/memory/**/*.md", "lib/memory/active/current.md"), true);
  assert.equal(matchesGlobPattern("lib/memory/*.md", "lib/inbox/in/a.md"), false);
});

test("digestContentHash abbreviates to requested width", () => {
  assert.equal(digestContentHash("abc", 7).length, 7);
});
