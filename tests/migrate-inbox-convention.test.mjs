import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  stemHasTimestampPrefix,
  parseFrontmatterFeatureId,
  slugFeatureId,
  listLegacyInboxArtifactRows,
  planInboxConventionMigration,
} from "../src/internal/tools/migrate-inbox-convention.mjs";

test("stemHasTimestampPrefix: detects SID_HHMM_ prefix", () => {
  assert.equal(stemHasTimestampPrefix("81300_0125_foo"), true);
  assert.equal(stemHasTimestampPrefix("foo_bar"), false);
});

test("parseFrontmatterFeatureId: reads feature_id", () => {
  const t = "---\nfeature_id: my-feature\n---\nbody";
  assert.equal(parseFrontmatterFeatureId(t), "my-feature");
});

test("slugFeatureId: normalizes slug", () => {
  assert.equal(slugFeatureId("My Feature!"), "my-feature");
});

test("planInboxConventionMigration: nested target shape for flat inbox/in file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-"));
  try {
    const inboxIn = path.join(tmp, "src", "inbox", "in");
    fs.mkdirSync(inboxIn, { recursive: true });
    fs.writeFileSync(
      path.join(inboxIn, "demo.md"),
      "---\nfeature_id: demo-feature\ncreated_at: 2024-06-15T14:30:00.000Z\n---\n",
      "utf8",
    );
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: { "src/inbox/in/demo.md": "2024-06-15T14:30:00.000Z" },
    });
    const fileStep = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("demo.md"),
    );
    assert.ok(fileStep);
    assert.match(
      fileStep.targetRel,
      /^src\/inbox\/in\/\d{6}_\d{2}-\d{2}-\d{2}\/\d+_1430_demo-feature_demo\/\d+_1430_demo\.md$/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: thread file loses feature-dir primary locator", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-t-"));
  try {
    const tdir = path.join(tmp, "src", "inbox", "threads", "my-feat");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, "round.md"), "body", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: { "src/inbox/threads/my-feat/round.md": "2024-07-01T08:05:00.000Z" },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.includes("round.md"),
    );
    assert.ok(step);
    assert.equal(step.targetRel.includes("/threads/my-feat/"), false);
    assert.match(step.targetRel, /^src\/inbox\/threads\/\d{6}_\d{2}-\d{2}-\d{2}\//);
    assert.ok(plan.renames.some((r) => r.kind === "inbox-remove-empty-dir"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-idem-"));
  try {
    const inboxIn = path.join(tmp, "src", "inbox", "in");
    fs.mkdirSync(inboxIn, { recursive: true });
    fs.writeFileSync(
      path.join(inboxIn, "86400_1200_already.md"),
      "x",
      "utf8",
    );
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: {
        "src/inbox/in/86400_1200_already.md": "2024-06-15T12:00:30.000Z",
      },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("86400_1200_already.md"),
    );
    assert.ok(step);
    assert.ok(step.targetRel.endsWith("/86400_1200_already.md"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("listLegacyInboxArtifactRows: real repo returns sorted rows", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const rows = listLegacyInboxArtifactRows(repoRoot);
  assert.ok(Array.isArray(rows));
  for (const r of rows) {
    assert.ok(r.rel.startsWith("src/inbox/"));
    assert.ok(!r.rel.includes("/notes/"));
  }
});
