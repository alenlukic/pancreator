import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECKER = path.join(ROOT, "lib/internal/tools/checks/check-operator-output.mjs");

test("check-operator-output passes on repository surfaces", () => {
  const r = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(
    r.status,
    0,
    r.stderr || r.stdout || "check-operator-output failed",
  );
});

test("check-operator-output flags bare pan in synthetic block", () => {
  const tmp = path.join(
    os.tmpdir(),
    `pancreator-operator-output-${process.pid}.md`,
  );
  fs.writeFileSync(tmp, "```bash\npan advance foo\n```\n", "utf8");
  try {
    const r = spawnSync(process.execPath, [CHECKER, tmp], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /bare pan/i);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
