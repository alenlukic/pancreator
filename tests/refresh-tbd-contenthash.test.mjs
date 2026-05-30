import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveAbbrevLen } from "../src/internal/tools/canonical-json-format.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "src/internal/tools/refresh-tbd-contenthash.mjs");

test("SHA-256 full-file digest matches glossary contract", () => {
  const body = "hello\n";
  const full = createHash("sha256").update(body, "utf8").digest("hex");
  assert.equal(full.length, 64);
  const abbrevLen = resolveAbbrevLen(ROOT);
  assert.equal(full.slice(0, abbrevLen).length, abbrevLen);
});

test("refresh-tbd-contenthash dry-run is idempotent after write pass", () => {
  const out = execFileSync("node", [TOOL, "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const report = JSON.parse(out);
  assert.equal(report.placeholdersResolved, 0);
  assert.equal(report.fullHashesAbbreviated, 0);
  assert.equal(report.remainingFullLength, 0);
});

test("resolveAbbrevLen honors PAN_JSON_FORMAT_ABBREV_LEN", () => {
  const prev = process.env.PAN_JSON_FORMAT_ABBREV_LEN;
  process.env.PAN_JSON_FORMAT_ABBREV_LEN = "12";
  try {
    assert.equal(resolveAbbrevLen(ROOT), 12);
  } finally {
    if (prev === undefined) {
      delete process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    } else {
      process.env.PAN_JSON_FORMAT_ABBREV_LEN = prev;
    }
  }
});
