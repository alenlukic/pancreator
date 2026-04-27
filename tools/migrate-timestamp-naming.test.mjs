import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  SID_SECONDS,
  daysToFds,
  secondsRemainingInDay,
  secondsRemainingInDayFromParts,
  hhmm,
  applyCollisionCounter,
  chooseTimestamp,
  migrateTargetForWorkPath,
  migrateTargetForInboxPath,
  inventoryReferences,
} from "./migrate-timestamp-naming.mjs";

test("daysToFds: FDS calendar day yields 0", () => {
  const d = new Date(Date.UTC(2500, 0, 1, 15, 0, 0));
  assert.equal(daysToFds(d), 0);
});

test("daysToFds: day before FDS yields 1", () => {
  const d = new Date(Date.UTC(2499, 11, 31, 0, 0, 0));
  assert.equal(daysToFds(d), 1);
});

test("daysToFds: day after FDS throws (operator-deferred rollover)", () => {
  const d = new Date(Date.UTC(2500, 0, 2, 0, 0, 0));
  assert.throws(() => daysToFds(d), /FDS_PLUS_ONE|after FDS/);
});

test("daysToFds: today before FDS is strictly positive", () => {
  const d = new Date(Date.UTC(2026, 3, 27, 0, 0, 0));
  const n = daysToFds(d);
  assert.ok(n > 0);
  assert.ok(n < 1_000_000);
});

test("secondsRemainingInDay: 00:00:00 UTC yields SID", () => {
  const d = new Date(Date.UTC(2024, 5, 15, 0, 0, 0));
  assert.equal(secondsRemainingInDay(d), SID_SECONDS);
});

test("secondsRemainingInDay: 23:59:59 UTC yields 1", () => {
  const d = new Date(Date.UTC(2024, 5, 15, 23, 59, 59));
  assert.equal(secondsRemainingInDay(d), 1);
});

test("secondsRemainingInDayFromParts: 23:59:60 leap-second edge yields 0", () => {
  // ECMAScript Date may not represent this instant; the helper encodes policy explicitly.
  assert.equal(secondsRemainingInDayFromParts(23, 59, 60), 0);
});

test("hhmm: pads hours and minutes", () => {
  const d = new Date(Date.UTC(2024, 5, 15, 7, 5, 0));
  assert.equal(hhmm(d), "0705");
});

test("applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first", () => {
  const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const t1 = t0 + 3600_000;
  const out = applyCollisionCounter([
    {
      id: "a",
      createdAtMs: t0,
      sid: 1,
      hhmm: "1200",
      semantic: "x",
    },
    {
      id: "b",
      createdAtMs: t1,
      sid: 1,
      hhmm: "1200",
      semantic: "x",
    },
  ]);
  const byId = Object.fromEntries(out.map((r) => [r.id, r.collisionCounter]));
  assert.equal(byId.b, 0);
  assert.equal(byId.a, 1);
});

test("applyCollisionCounter: 3 collisions use 0,1,2", () => {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  const rows = [0, 1, 2].map((i) => ({
    id: `id${i}`,
    createdAtMs: base + i * 60_000,
    sid: 9,
    hhmm: "0900",
    semantic: "dup",
  }));
  const out = applyCollisionCounter(rows);
  const counters = [...out].sort((a, b) => a.createdAtMs - b.createdAtMs).map((r) => r.collisionCounter);
  assert.deepEqual(counters, [2, 1, 0]);
});

test("applyCollisionCounter: 5 collisions use 0 through 4", () => {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  const rows = [0, 1, 2, 3, 4].map((i) => ({
    id: `x${i}`,
    createdAtMs: base + i * 1000,
    sid: 3,
    hhmm: "0800",
    semantic: "y",
  }));
  const out = applyCollisionCounter(rows);
  const set = new Set(out.map((r) => r.collisionCounter));
  assert.equal(set.size, 5);
  assert.ok([...set].every((c) => c >= 0 && c <= 4));
});

test("chooseTimestamp: git rung wins over frontmatter", () => {
  const r = chooseTimestamp(
    { path: "p", text: "---\ncreated_at: 2019-01-01T00:00:00Z\n---\n" },
    "2021-06-01T00:00:00.000Z",
    { mtimeMs: Date.UTC(2022, 0, 1) },
  );
  assert.equal(r.source, "git");
  assert.equal(r.iso, "2021-06-01T00:00:00.000Z");
});

test("chooseTimestamp: frontmatter when git absent", () => {
  const r = chooseTimestamp(
    { path: "p", text: "---\ncreated_at: 2019-02-02T00:00:00Z\n---\n" },
    null,
    { mtimeMs: Date.UTC(2022, 0, 1) },
  );
  assert.equal(r.source, "frontmatter");
  assert.equal(r.iso, new Date("2019-02-02T00:00:00.000Z").toISOString());
});

test("chooseTimestamp: mtime when git and frontmatter absent", () => {
  const mt = Date.UTC(2023, 5, 6, 12, 0, 0);
  const r = chooseTimestamp({ path: "p", text: "no fm" }, null, { mtimeMs: mt }, {});
  assert.equal(r.source, "mtime");
  assert.equal(r.iso, new Date(mt).toISOString());
});

test("chooseTimestamp: operator override replaces mtime (last precedence rung)", () => {
  const mt = Date.UTC(2023, 5, 6, 12, 0, 0);
  const r = chooseTimestamp(
    { path: "p", text: "no fm" },
    null,
    { mtimeMs: mt },
    { operatorIsoOverride: "2020-01-03T00:00:00.000Z" },
  );
  assert.equal(r.source, "override");
  assert.equal(r.iso, "2020-01-03T00:00:00.000Z");
});

test("migrateTargetForWorkPath: snapshot shape for flat work task", () => {
  const repoRoot = "/repo";
  const chosenDate = new Date(Date.UTC(2024, 5, 15, 14, 30, 0));
  const abs = path.join(repoRoot, "work", "compliance-tests");
  const out = migrateTargetForWorkPath(abs, { repoRoot, chosenDate });
  assert.match(
    out.targetRel,
    /^work\/\d{6}_\d{2}-\d{2}-\d{2}\/\d+_1430_compliance-tests\/$/,
  );
  assert.equal(out.sourceRel, "work/compliance-tests/");
});

test("migrateTargetForInboxPath: snapshot for thread round file", () => {
  const repoRoot = "/repo";
  const chosenDate = new Date(Date.UTC(2024, 5, 15, 14, 30, 0));
  const abs = path.join(
    repoRoot,
    "inbox",
    "threads",
    "timestamp-naming-conventions",
    "round-01-clarify.md",
  );
  const out = migrateTargetForInboxPath(abs, {
    repoRoot,
    chosenDate,
    collisionCounter: null,
  });
  assert.match(
    out.targetRel,
    /^inbox\/threads\/timestamp-naming-conventions\/\d+_1430_round-01-clarify\.md$/,
  );
});

test("inventoryReferences: finds a known path string in repo", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const hits = inventoryReferences("work/173009_04-27-26/68576_0457_compliance-tests", repoRoot, [
    "memory",
    "work",
  ]);
  assert.ok(hits.length > 0);
  const files = new Set(hits.map((h) => h.file));
  assert.ok([...files].some((f) => f.endsWith(".md") || f.endsWith(".json")));
});
