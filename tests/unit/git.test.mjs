import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createFixture } from "../helpers.mjs";
import { gitWorkspaceSnapshot, snapshotChanged } from "../../src/lib/git.mjs";

test("workspace fingerprint detects content changes when status labels stay the same", () => {
  const root = createFixture();
  const file = path.join(root, "src", "base.js");
  writeFileSync(file, "export const base = 'first';\n");
  const before = gitWorkspaceSnapshot(root);
  writeFileSync(file, "export const base = 'second';\n");
  const after = gitWorkspaceSnapshot(root);
  assert.equal(before.entries[0].slice(0, 2), after.entries[0].slice(0, 2));
  assert.equal(snapshotChanged(before, after), true);
});
