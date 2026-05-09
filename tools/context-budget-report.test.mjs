import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("context-budget-report exits zero and labels rough token estimate", () => {
  const script = path.join(import.meta.dirname, "context-budget-report.mjs");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || "non-zero exit");
  }
  if (!r.stdout.includes("Whole repo")) {
    throw new Error("expected whole repo section in stdout");
  }
  if (!r.stdout.includes("chars/4")) {
    throw new Error("expected rough estimate disclaimer in stdout");
  }
});
