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
  normalizeInboxSemanticStem,
  buildInboxTaskSemantic,
  isMigratedThreadTaskSegment,
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
  assert.equal(slugFeatureId("2174_2323_2026-04-25-2259-docs-operator-readme-v1"), "docs-operator-readme-v1");
});

test("normalizeInboxSemanticStem: strips legacy timestamp/date prefixes", () => {
  assert.equal(
    normalizeInboxSemanticStem("2174_2323_2026-04-25-2259-docs-operator-readme-v1"),
    "docs-operator-readme-v1",
  );
  assert.equal(normalizeInboxSemanticStem("68576_0457_compliance-tests"), "compliance-tests");
});

test("buildInboxTaskSemantic: avoids duplicating feature and task stem tokens", () => {
  assert.equal(
    buildInboxTaskSemantic("compliance-tests", "68576_0457_compliance-tests"),
    "compliance-tests",
  );
  assert.equal(
    buildInboxTaskSemantic("timestamp-naming-conventions", "50991_0950_round-01-clarify"),
    "timestamp-naming-conventions_round-01-clarify",
  );
  assert.equal(
    buildInboxTaskSemantic("docs-operator-readme-v1", "2174_2323_2026-04-25-2259-docs-operator-readme-v1"),
    "docs-operator-readme-v1",
  );
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

test("isMigratedThreadTaskSegment: matches work-style task directory token", () => {
  assert.equal(isMigratedThreadTaskSegment("86400_1200_my-feature_demo"), true);
  assert.equal(isMigratedThreadTaskSegment("legacy-subdir"), false);
});

test("planInboxConventionMigration: thread file in nested legacy subdirectory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-nest-"));
  try {
    const nested = path.join(tmp, "src", "inbox", "threads", "my-feat", "old-rounds");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "note.md"), "body", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: {
        "src/inbox/threads/my-feat/old-rounds/note.md": "2024-07-01T08:05:00.000Z",
      },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("old-rounds/note.md"),
    );
    assert.ok(step);
    assert.match(step.targetRel, /^src\/inbox\/threads\/\d{6}_\d{2}-\d{2}-\d{2}\//);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("listLegacyInboxArtifactRows: skips migrated day/task subtrees under legacy feature", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-skip-"));
  try {
    const legacyFeat = path.join(tmp, "src", "inbox", "threads", "feat-a");
    const dayLike = path.join(legacyFeat, "172995_05-11-26");
    const taskLike = path.join(legacyFeat, "86500_0830_task_sem");
    fs.mkdirSync(path.join(dayLike, "extra"), { recursive: true });
    fs.writeFileSync(path.join(dayLike, "extra", "skip-me.md"), "x", "utf8");
    fs.mkdirSync(taskLike, { recursive: true });
    fs.writeFileSync(path.join(taskLike, "skip-too.md"), "y", "utf8");
    fs.writeFileSync(path.join(legacyFeat, "keep.md"), "z", "utf8");

    const rows = listLegacyInboxArtifactRows(tmp);
    const rels = rows.filter((r) => r.queue === "threads").map((r) => r.rel);
    assert.ok(rels.includes("src/inbox/threads/feat-a/keep.md"));
    assert.ok(!rels.some((r) => r.includes("skip-me")));
    assert.ok(!rels.some((r) => r.includes("skip-too")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: task directory semantics are deduplicated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-dedupe-"));
  try {
    const archiveIn = path.join(tmp, "src", "inbox", "archive", "in");
    fs.mkdirSync(archiveIn, { recursive: true });
    fs.writeFileSync(path.join(archiveIn, "68576_0457_compliance-tests.md"), "body", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: {
        "src/inbox/archive/in/173009_04-27-26/68576_0457_compliance-tests/68576_0457_compliance-tests.md": "2024-04-27T00:57:04.000Z",
      },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("68576_0457_compliance-tests.md"),
    );
    assert.ok(step);
    assert.ok(!step.targetRel.includes("compliance-tests_68576_0457_compliance-tests"));

    const targetParts = step.targetRel.split("/");
    const taskDir = targetParts.at(-2);
    const leafName = targetParts.at(-1);

    assert.match(taskDir, /^\d+_\d{4}_compliance-tests$/);
    assert.equal(leafName, "68576_0457_compliance-tests.md");
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
