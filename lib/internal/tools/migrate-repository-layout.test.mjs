import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  applyReferenceReplacements,
  isExcludedFromReferenceRewrite,
  planTreeMoves,
  REFERENCE_REPLACEMENTS,
  REPO_ROOT,
} from "./migrate-repository-layout.mjs";

test("reference replacements map archive, work, and lib paths longest-first", () => {
  const sample = [
    "src/inbox/archive/in/day/item.md",
    "src/internal/work_archive/day/task/plan.md",
    "src/work/day/task/handoff.md",
    "src/skills/foo/SKILL.md",
    "src/memory/handbook/index.md",
    "/src/personas/coder.md",
  ].join("\n");
  const { text, count } = applyReferenceReplacements(sample);
  assert.ok(count > 0);
  assert.match(text, /archive\/inbox\/in\/day\/item\.md/);
  assert.match(text, /archive\/work\/day\/task\/plan\.md/);
  assert.match(text, /work\/day\/task\/handoff\.md/);
  assert.match(text, /lib\/personas\/skills\/foo\/SKILL\.md/);
  assert.match(text, /lib\/memory\/handbook\/index\.md/);
  assert.match(text, /\/lib\/personas\/coder\.md/);
  assert.doesNotMatch(text, /\bsrc\//);
});

test("operator sandbox paths are excluded from rewrite planning", () => {
  assert.ok(isExcludedFromReferenceRewrite("lib/inbox/notes/private.md"));
  assert.ok(isExcludedFromReferenceRewrite("lib/inbox/notes/private.md"));
  assert.ok(!isExcludedFromReferenceRewrite("lib/inbox/in/day/item.md"));
});

test("tree move plan includes src to lib rename when src exists", () => {
  const moves = planTreeMoves(REPO_ROOT);
  const hasSrcToLib = moves.some((m) => m.from === "src" && m.to === "lib");
  assert.equal(hasSrcToLib, existsSync(path.join(REPO_ROOT, "src")));
});

test("no shim aliases are introduced in replacement table", () => {
  for (const [, to] of REFERENCE_REPLACEMENTS) {
    assert.doesNotMatch(to, /symlink|alias|fallback|shim/i);
  }
});

test("dry-run planning is deterministic for mapping rules", () => {
  const first = applyReferenceReplacements("work/a work/b");
  const second = applyReferenceReplacements("work/a work/b");
  assert.deepEqual(first, second);
  assert.equal(first.text, "work/a work/b");
});
