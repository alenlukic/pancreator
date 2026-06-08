import assert from "node:assert/strict";
import fs, { existsSync } from "node:fs";
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
  buildInboxLeafSemantic,
  parseIsoTimestampFromStem,
  chooseInboxNamingInstant,
  isCanonicalInboxPath,
  isMigratedThreadTaskSegment,
  listLegacyInboxArtifactRows,
  listInboxArtifactRows,
  listEmptyInboxDirectories,
  pruneEmptyInboxDirectories,
  planInboxConventionMigration,
} from "../lib/internal/tools/migrate-inbox-convention.mjs";

test("stemHasTimestampPrefix: detects SID_HHMM_ prefix", () => {
  assert.equal(stemHasTimestampPrefix("81300_0125_foo"), true);
  assert.equal(stemHasTimestampPrefix("foo_bar"), false);
});

test("parseIsoTimestampFromStem: reads embedded Zulu instant", () => {
  assert.equal(
    parseIsoTimestampFromStem("2026-05-23T03-22-00Z-intake-json-formatting"),
    "2026-05-23T03:22:00Z",
  );
});

test("chooseInboxNamingInstant: prefers filename ISO over git", () => {
  const chosen = chooseInboxNamingInstant(
    { path: "lib/inbox/in/2026-05-23T03-22-00Z-demo.md", text: "" },
    "2026-05-25T04:06:01.000Z",
    { mtimeMs: 0 },
  );
  assert.equal(chosen.source, "filename-iso");
  assert.equal(chosen.iso, new Date("2026-05-23T03:22:00Z").toISOString());
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
});

test("buildInboxLeafSemantic: strips timestamp and ISO segments for basename suffix", () => {
  assert.equal(
    buildInboxLeafSemantic("71639_0406_2026-05-23T03-22-00Z-intake-json-formatting-ratification"),
    "intake-json-formatting-ratification",
  );
  assert.equal(buildInboxLeafSemantic("50991_0950_round-01-clarify"), "round-01-clarify");
});

test("isCanonicalInboxPath: rejects per-artifact task subdirectory under threads", () => {
  assert.equal(
    isCanonicalInboxPath(
      "lib/inbox/threads/172981_05-25-26/71639_0406_json-formatting_round-01/71639_0406_round-01.md",
      "threads",
    ),
    false,
  );
  assert.equal(
    isCanonicalInboxPath(
      "lib/inbox/threads/173009_04-27-26/timestamp-naming-conventions/51237_0946_round-01-clarify.md",
      "threads",
    ),
    true,
  );
});

test("planInboxConventionMigration: A1 flat leaf under day bucket for inbox/in", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-"));
  try {
    const inboxIn = path.join(tmp, "lib", "inbox", "in");
    fs.mkdirSync(inboxIn, { recursive: true });
    fs.writeFileSync(
      path.join(inboxIn, "demo.md"),
      "---\nfeature_id: demo-feature\ncreated_at: 2024-06-15T14:30:00.000Z\n---\n",
      "utf8",
    );
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: { "lib/inbox/in/demo.md": "2024-06-15T14:30:00.000Z" },
    });
    const fileStep = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("demo.md"),
    );
    assert.ok(fileStep);
    assert.match(
      fileStep.targetRel,
      /^lib\/inbox\/in\/\d{6}_\d{2}-\d{2}-\d{2}\/\d+_1430_demo\.md$/,
    );
    assert.equal(fileStep.targetRel.split("/").length, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: A2 thread file under day and feature without task subdir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-t-"));
  try {
    const tdir = path.join(tmp, "lib", "inbox", "threads", "my-feat");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, "round.md"), "body", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: { "lib/inbox/threads/my-feat/round.md": "2024-07-01T08:05:00.000Z" },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.includes("round.md"),
    );
    assert.ok(step);
    assert.equal(step.targetRel.includes("/threads/my-feat/round.md"), false);
    assert.match(
      step.targetRel,
      /^lib\/inbox\/threads\/\d{6}_\d{2}-\d{2}-\d{2}\/my-feat\/\d+_\d{4}_round\.md$/,
    );
    assert.equal(step.targetRel.split("/").length, 6);
    assert.ok(plan.renames.some((r) => r.kind === "inbox-remove-empty-dir"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: reshapes wrongly nested thread task subdirectory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-reshape-"));
  try {
    const wrong = path.join(
      tmp,
      "lib",
      "inbox",
      "threads",
      "173009_04-27-26",
      "50991_0950_timestamp-naming-conventions_round-01-clarify",
    );
    fs.mkdirSync(wrong, { recursive: true });
    fs.writeFileSync(
      path.join(wrong, "50991_0950_round-01-clarify.md"),
      "---\nfeature_id: timestamp-naming-conventions\ncreated_at: 2026-04-27T09:46:03Z\n---\n",
      "utf8",
    );
    const plan = planInboxConventionMigration(tmp);
    const step = plan.renames.find((r) =>
      r.sourceRel.endsWith("50991_0950_round-01-clarify.md"),
    );
    assert.ok(step);
    assert.equal(
      step.targetRel,
      "lib/inbox/threads/173009_04-27-26/timestamp-naming-conventions/51237_0946_round-01-clarify.md",
    );
    assert.equal(step.timestamp.source, "frontmatter");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: uses filename ISO for intake ratification path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-iso-"));
  try {
    const wrong = path.join(
      tmp,
      "lib",
      "inbox",
      "in",
      "172981_05-25-26",
      "71639_0406_json-formatting_t03-22-00z-intake-json-formatting-ratification",
    );
    fs.mkdirSync(wrong, { recursive: true });
    fs.writeFileSync(
      path.join(wrong, "71639_0406_2026-05-23T03-22-00Z-intake-json-formatting-ratification.md"),
      "body",
      "utf8",
    );
    const plan = planInboxConventionMigration(tmp);
    const step = plan.renames.find((r) =>
      r.sourceRel.includes("intake-json-formatting-ratification.md"),
    );
    assert.ok(step);
    assert.match(step.targetRel, /\/\d+_0322_intake-json-formatting-ratification\.md$/);
    assert.equal(step.targetRel.split("/").length, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-idem-"));
  try {
    const inboxIn = path.join(tmp, "lib", "inbox", "in");
    fs.mkdirSync(inboxIn, { recursive: true });
    fs.writeFileSync(path.join(inboxIn, "86400_1200_already.md"), "x", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: {
        "lib/inbox/in/86400_1200_already.md": "2024-06-15T12:00:30.000Z",
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

test("listInboxArtifactRows: includes wrongly nested task subtrees", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-skip-"));
  try {
    const dayDir = path.join(tmp, "lib", "inbox", "threads", "172995_05-11-26");
    const taskDir = path.join(dayDir, "86500_0830_task_sem");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "reshape-me.md"), "y", "utf8");

    const rows = listInboxArtifactRows(tmp);
    const rels = rows.filter((r) => r.queue === "threads").map((r) => r.rel);
    assert.ok(rels.includes("lib/inbox/threads/172995_05-11-26/86500_0830_task_sem/reshape-me.md"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("planInboxConventionMigration: archive flat leaf has no task subdirectory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-dedupe-"));
  try {
    const archiveIn = path.join(tmp, ".pan/archive", "inbox", "in");
    fs.mkdirSync(archiveIn, { recursive: true });
    fs.writeFileSync(path.join(archiveIn, "68576_0457_compliance-tests.md"), "body", "utf8");
    const plan = planInboxConventionMigration(tmp, {
      operatorIsoByRel: {
        ".pan/archive/inbox/in/68576_0457_compliance-tests.md": "2024-04-27T00:57:04.000Z",
      },
    });
    const step = plan.renames.find(
      (r) => r.kind === "inbox-nested-file" && r.sourceRel.endsWith("68576_0457_compliance-tests.md"),
    );
    assert.ok(step);
    assert.match(
      step.targetRel,
      /^\.pan\/archive\/inbox\/in\/\d{6}_\d{2}-\d{2}-\d{2}\/\d+_\d{4}_compliance-tests\.md$/,
    );
    assert.equal(step.targetRel.split("/").length, 6);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("pruneEmptyInboxDirectories: removes nested empty day and task folders", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icm-prune-"));
  try {
    const orphanDay = path.join(tmp, "lib", "inbox", "in", "172981_05-25-26");
    const orphanTask = path.join(orphanDay, "71639_0406_demo_task");
    fs.mkdirSync(orphanTask, { recursive: true });
    const keep = path.join(tmp, "lib", "inbox", "in", "172983_05-23-26");
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, "67055_0522_demo.md"), "x", "utf8");

    const listed = listEmptyInboxDirectories(tmp);
    assert.ok(listed.includes("lib/inbox/in/172981_05-25-26/71639_0406_demo_task"));
    assert.ok(!listed.includes("lib/inbox/in/172983_05-23-26"));

    const dry = pruneEmptyInboxDirectories(tmp, { dryRun: true });
    assert.equal(dry.removed.length, 2);
    assert.ok(dry.removed.includes("lib/inbox/in/172981_05-25-26/71639_0406_demo_task"));
    assert.ok(dry.removed.includes("lib/inbox/in/172981_05-25-26"));
    assert.ok(existsSync(orphanTask));

    const applied = pruneEmptyInboxDirectories(tmp);
    assert.equal(applied.removed.length, 2);
    assert.ok(!existsSync(orphanDay));
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
    assert.ok(r.rel.startsWith("lib/inbox/") || r.rel.startsWith(".pan/archive/inbox/"));
    assert.ok(!r.rel.includes("/notes/"));
  }
});
