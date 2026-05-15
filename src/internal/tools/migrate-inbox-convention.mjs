#!/usr/bin/env node
/**
 * Inbox convention migration: nested day + task directories mirroring `src/work/`.
 * Planner and writer live here; `migrate-timestamp-naming.mjs` merges this plan
 * into the combined timestamp migration manifest.
 *
 * @see src/memory/features/inbox-convention-migration/spec.md
 */

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  renameSync,
  mkdirSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chooseTimestamp,
  gitOldestAddIso,
  applyCollisionCounter,
  buildBasename,
  daysToFds,
  pad6,
  mmDdYySuffix,
  secondsRemainingInDay,
  hhmm,
  inventoryReferences,
  isExcludedFromMigration,
  applyReferenceUpdatesFromManifest,
} from "./migrate-timestamp-naming.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Work-style day directory basename pattern (UTC). */
const DAY_DIR_RE = /^\d{6}_\d{2}-\d{2}-\d{2}$/;

/**
 * Post-migration thread task directory: SID + `_` + HHMM + `_` + semantic (see buildBasename).
 * Used to skip already-nested thread subtrees during legacy discovery.
 */
const MIGRATED_THREAD_TASK_SEGMENT_RE = /^\d+_\d{4}_/u;

/**
 * @param {string} stem
 * @returns {boolean} True when stem already has `{SID}_{HHMM}_` prefix (idempotent pass).
 */
export function stemHasTimestampPrefix(stem) {
  return /^\d+_\d{4}_/u.test(stem);
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseFrontmatterFeatureId(text) {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const fm = text.slice(3, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^\s*feature_id\s*:\s*(.+)\s*$/i);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/**
 * @param {string} dirBasename
 * @returns {boolean} True when basename matches migrated inbox thread task directory pattern.
 */
export function isMigratedThreadTaskSegment(dirBasename) {
  return MIGRATED_THREAD_TASK_SEGMENT_RE.test(dirBasename);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function slugFeatureId(raw) {
  const slug = normalizeInboxSemanticStem(raw).slice(0, 80);
  return slug.length > 0 ? slug : "inbox";
}

/**
 * Normalize filename-derived semantic text before using it in a work-style task
 * directory. Legacy inbox names often already include SID/HHMM and date tokens;
 * retaining those in the semantic suffix produces paths like
 * `68576_0457_compliance-tests_68576_0457_compliance-tests`.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeInboxSemanticStem(raw) {
  return raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/^\d+_\d{4}_/u, "")
    .replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]\d{4}[-_]*/u, "")
    .replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]*/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * @param {string} featureId
 * @param {string} fileStem
 * @returns {string}
 */
export function buildInboxTaskSemantic(featureId, fileStem) {
  const feature = slugFeatureId(featureId);
  const taskStem = normalizeInboxSemanticStem(fileStem);
  if (!taskStem || taskStem === feature) {
    return feature;
  }
  const featurePrefix = `${feature}-`;
  if (taskStem.startsWith(featurePrefix)) {
    const remainder = taskStem.slice(featurePrefix.length).replace(/^-+|-+$/gu, "");
    return remainder ? `${feature}_${remainder}` : feature;
  }
  return `${feature}_${taskStem}`;
}

/**
 * @param {string} repoRoot
 * @returns {Array<{ abs: string, rel: string, queue: 'in' | 'out' | 'archive-in' | 'threads', threadFeatureId: string | null }>}
 */
export function listLegacyInboxArtifactRows(repoRoot) {
  /** @type {Array<{ abs: string, rel: string, queue: 'in' | 'out' | 'archive-in' | 'threads', threadFeatureId: string | null }>} */
  const out = [];

  const roots = /** @type {const} */ ([
    { queue: "in", segs: ["src", "inbox", "in"] },
    { queue: "out", segs: ["src", "inbox", "out"] },
    { queue: "archive-in", segs: ["src", "inbox", "archive", "in"] },
  ]);
  for (const { queue, segs } of roots) {
    const dir = path.join(repoRoot, ...segs);
    if (!existsSync(dir)) {
      continue;
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith(".")) {
        continue;
      }
      const rel = [...segs, e.name].join("/");
      if (isExcludedFromMigration(rel)) {
        continue;
      }
      out.push({
        abs: path.join(dir, e.name),
        rel,
        queue,
        threadFeatureId: null,
      });
    }
  }

  const threads = path.join(repoRoot, "src", "inbox", "threads");
  if (existsSync(threads)) {
    for (const feat of readdirSync(threads, { withFileTypes: true })) {
      if (!feat.isDirectory() || feat.name.startsWith(".") || DAY_DIR_RE.test(feat.name)) {
        continue;
      }
      const featureSlug = feat.name;
      const d0 = path.join(threads, featureSlug);

      /**
       * Legacy thread files may live under nested subdirectories. Skip subtrees that already
       * match migrated day/task layout; never traverse `notes`.
       * @param {string} dirAbs
       * @param {string[]} relTail after `src/inbox/threads/` (includes feature slug).
       */
      const walk = (dirAbs, relTail) => {
        for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
          if (e.name.startsWith(".")) {
            continue;
          }
          const relJoined = ["src", "inbox", "threads", ...relTail, e.name].join("/");
          if (relJoined.includes("/notes/") || relJoined.endsWith("/notes")) {
            continue;
          }
          if (e.isDirectory()) {
            if (DAY_DIR_RE.test(e.name) || isMigratedThreadTaskSegment(e.name)) {
              continue;
            }
            walk(path.join(dirAbs, e.name), [...relTail, e.name]);
          } else if (e.isFile()) {
            if (isExcludedFromMigration(relJoined)) {
              continue;
            }
            out.push({
              abs: path.join(dirAbs, e.name),
              rel: relJoined,
              queue: "threads",
              threadFeatureId: featureSlug,
            });
          }
        }
      };

      walk(d0, [featureSlug]);
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * @param {typeof listLegacyInboxArtifactRows extends (...args: infer R) => infer T ? T extends Array<infer U> ? U : never : never} row
 * @param {string} text
 * @returns {string}
 */
function resolveFeatureIdForRow(row, text) {
  if (row.threadFeatureId) {
    return slugFeatureId(row.threadFeatureId);
  }
  const fm = parseFrontmatterFeatureId(text);
  if (fm) {
    return slugFeatureId(fm);
  }
  const base = path.posix.basename(row.rel);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  return slugFeatureId(stem);
}

/**
 * Target queue prefix (POSIX segments, no `src/inbox` prefix).
 * @param {'in' | 'out' | 'archive-in' | 'threads'} queue
 */
function queuePrefixSegments(queue) {
  switch (queue) {
    case "in":
      return ["src", "inbox", "in"];
    case "out":
      return ["src", "inbox", "out"];
    case "archive-in":
      return ["src", "inbox", "archive", "in"];
    case "threads":
      return ["src", "inbox", "threads"];
    default: {
      throw new Error(`queuePrefixSegments: unknown queue ${queue}`);
    }
  }
}

/**
 * Deterministic inbox nesting plan (no I/O writes).
 * @param {string} repoRoot
 * @param {{ operatorIsoByRel?: Record<string, string> }} [opts]
 * @returns {{ renames: Array<object>, referenceUpdates: Array<object>, collisions: string[], summary: object }}
 */
export function planInboxConventionMigration(repoRoot, opts = {}) {
  const operatorIsoByRel = opts.operatorIsoByRel ?? {};
  const rows = listLegacyInboxArtifactRows(repoRoot);

  /** @type {Array<{ rel: string, queue: string, threadFeatureId: string | null, chosen: ReturnType<typeof chooseTimestamp>, d: Date, featureId: string, fileStem: string, ext: string, dayDir: string, sid: number, hm: string, taskSemantic: string, needsBasenamePrefix: boolean }>} */
  const enriched = [];

  for (const row of rows) {
    let text = "";
    try {
      const buf = readFileSync(row.abs);
      if (!buf.includes(0)) {
        text = buf.toString("utf8");
      }
    } catch {
      /* ignore */
    }
    const gitIso = gitOldestAddIso(repoRoot, row.rel);
    let st;
    try {
      st = statSync(row.abs);
    } catch {
      continue;
    }
    const chosen = chooseTimestamp(
      { path: row.rel, text },
      gitIso,
      { mtimeMs: st.mtimeMs },
      { operatorIsoOverride: operatorIsoByRel[row.rel] ?? null },
    );
    const d = new Date(chosen.iso);
    const base = path.posix.basename(row.rel);
    const fileStem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
    const featureId = resolveFeatureIdForRow(row, text);
    const taskSemantic = buildInboxTaskSemantic(featureId, fileStem);
    const days = daysToFds(d);
    const dayDir = `${pad6(days)}_${mmDdYySuffix(d)}`;
    const sid = secondsRemainingInDay(d);
    const hm = hhmm(d);
    const needsBasenamePrefix = !stemHasTimestampPrefix(fileStem);

    enriched.push({
      rel: row.rel,
      queue: row.queue,
      threadFeatureId: row.threadFeatureId,
      chosen,
      d,
      featureId,
      fileStem,
      ext,
      dayDir,
      sid,
      hm,
      taskSemantic,
      needsBasenamePrefix,
    });
  }

  /** Task-directory collision groups: queue + day + sid + HHMM + taskSemantic */
  /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string }>} */
  const taskDirCollisionInputs = enriched.map((e) => ({
    id: e.rel,
    createdAtMs: e.d.getTime(),
    sid: e.sid,
    hhmm: e.hm,
    semantic: e.taskSemantic,
  }));
  const taskDirResolved = applyCollisionCounter(taskDirCollisionInputs);
  const taskDirByRel = new Map(taskDirResolved.map((t) => [t.id, t]));

  /** File-basename collision (only rows that need new prefix), per legacy flat parent. */
  /** @type {Map<string, Array<typeof enriched[0]>>} */
  const byLegacyParent = new Map();
  for (const e of enriched) {
    if (!e.needsBasenamePrefix) {
      continue;
    }
    const parent = path.posix.dirname(e.rel);
    const g = byLegacyParent.get(parent) ?? [];
    g.push(e);
    byLegacyParent.set(parent, g);
  }

  /** @type {Map<string, number | null>} */
  const fileBasenameCounterByRel = new Map();
  for (const [, group] of byLegacyParent) {
    /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string }>} */
    const ic = group.map((e) => ({
      id: e.rel,
      createdAtMs: e.d.getTime(),
      sid: e.sid,
      hhmm: e.hm,
      semantic: e.fileStem,
    }));
    const resolved = applyCollisionCounter(ic);
    for (const r of resolved) {
      fileBasenameCounterByRel.set(r.id, r.collisionCounter);
    }
  }

  /** @type {Array<{ sourceRel: string, targetRel: string, kind: string, timestamp: { iso: string, source: string } }>} */
  const renames = [];
  /** @type {Set<string>} */
  const threadFeatureDirsToDrop = new Set();

  for (const e of enriched) {
    const tdc = taskDirByRel.get(e.rel);
    if (!tdc) {
      continue;
    }
    const taskDirBasename = buildBasename(
      tdc.sid,
      tdc.hhmm,
      tdc.collisionCounter,
      e.taskSemantic,
    );
    const leaf = e.needsBasenamePrefix
      ? `${buildBasename(e.sid, e.hm, fileBasenameCounterByRel.get(e.rel) ?? null, e.fileStem)}${e.ext}`
      : `${e.fileStem}${e.ext}`;

    const prefix = queuePrefixSegments(
      /** @type {'in' | 'out' | 'archive-in' | 'threads'} */ (e.queue),
    );
    const targetRel = [...prefix, e.dayDir, taskDirBasename, leaf].join("/");
    renames.push({
      sourceRel: e.rel,
      targetRel,
      kind: "inbox-nested-file",
      timestamp: { iso: e.chosen.iso, source: e.chosen.source },
    });

    if (e.queue === "threads" && e.threadFeatureId) {
      threadFeatureDirsToDrop.add(
        path.posix.join("src/inbox/threads", e.threadFeatureId) + "/",
      );
    }
  }

  for (const dirRel of [...threadFeatureDirsToDrop].sort((a, b) => b.length - a.length)) {
    renames.push({
      sourceRel: dirRel,
      targetRel: dirRel,
      kind: "inbox-remove-empty-dir",
      timestamp: { iso: "", source: "cleanup" },
    });
  }

  /** @type {Array<{ file: string, line: number, column: number, jsonPointer: string | null, before: string, after: string }>} */
  const referenceUpdates = [];
  for (const r of renames) {
    if (r.kind !== "inbox-nested-file" || r.sourceRel === r.targetRel) {
      continue;
    }
    const legacy = r.sourceRel;
    const target = r.targetRel;
    const hits = inventoryReferences(legacy, repoRoot);
    for (const h of hits) {
      referenceUpdates.push({
        file: h.file,
        line: h.line,
        column: h.column,
        jsonPointer: null,
        before: h.before,
        after: h.before.replaceAll(legacy, target),
      });
    }
  }

  /** @type {string[]} */
  const collisions = [];
  const seen = new Map();
  for (const r of renames) {
    if (r.kind !== "inbox-nested-file") {
      continue;
    }
    const t = r.targetRel;
    const c = seen.get(t) ?? 0;
    seen.set(t, c + 1);
    if (c >= 1) {
      collisions.push(`duplicate inbox target ${t}`);
    }
  }

  return {
    renames,
    referenceUpdates,
    collisions,
    summary: {
      legacyArtifacts: rows.length,
      plannedFileRenames: renames.filter((r) => r.kind === "inbox-nested-file").length,
      threadFeatureDirsRemoved: threadFeatureDirsToDrop.size,
    },
  };
}

/**
 * Apply inbox-specific rename steps from a combined manifest.
 * @param {Array<{ sourceRel: string, targetRel: string, kind: string }>} renames
 * @param {string} repoRoot
 */
export function applyInboxRenamesFromManifest(renames, repoRoot) {
  const inboxKinds = renames.filter(
    (r) => r.kind === "inbox-nested-file" || r.kind === "inbox-remove-empty-dir",
  );
  const files = inboxKinds.filter((r) => r.kind === "inbox-nested-file");
  const sorted = [...files].sort((a, b) =>
    b.targetRel.split("/").length - a.targetRel.split("/").length,
  );
  for (const r of sorted) {
    const fromRel = r.sourceRel.replace(/\/+$/, "");
    const toRel = r.targetRel.replace(/\/+$/, "");
    if (fromRel === toRel) {
      continue;
    }
    const fromAbs = path.join(repoRoot, fromRel);
    const toAbs = path.join(repoRoot, toRel);
    const toParent = path.dirname(toAbs);
    mkdirSync(toParent, { recursive: true });
    renameSync(fromAbs, toAbs);
  }
  const dirs = inboxKinds.filter((r) => r.kind === "inbox-remove-empty-dir");
  for (const r of dirs) {
    const dirAbs = path.join(repoRoot, r.sourceRel.replace(/\/+$/, ""));
    try {
      if (!existsSync(dirAbs)) {
        continue;
      }
      const left = readdirSync(dirAbs);
      if (left.length === 0) {
        rmdirSync(dirAbs);
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {Array<{ sourceRel: string, targetRel: string, kind: string }>} renames
 * @param {string} [artifactIndexRel]
 */
export function writeInboxArtifactIndex(repoRoot, renames, artifactIndexRel = "src/inbox/artifact-index.json") {
  const threadTargets = renames
    .filter((r) => r.kind === "inbox-nested-file" && r.targetRel.startsWith("src/inbox/threads/"))
    .map((r) => r.targetRel)
    .sort();
  const payload = {
    schema: "tesseract.inbox-artifact-index.v1",
    generatedAt: new Date().toISOString(),
    threads: threadTargets,
  };
  const abs = path.join(repoRoot, artifactIndexRel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * @param {unknown} m
 * @returns {m is { renames?: Array<{ sourceRel: string, targetRel: string, kind: string }>, referenceUpdates?: Array<{ file: string, before: string, after: string }> }}
 */
function isPersistedInboxMigrationManifest(m) {
  return (
    typeof m === "object" &&
    m !== null &&
    /** @type {{ schema?: string }} */ (m).schema ===
      "tesseract.inbox-convention-migration-manifest.v1"
  );
}

function parseArgs(argv) {
  let dryRun = true;
  let write = false;
  /** @type {string | null} */
  let manifestPath = null;
  let root = path.resolve(__dirname, "..", "..", "..");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      write = false;
    } else if (a === "--write") {
      write = true;
      dryRun = false;
    } else if (a === "--manifest" && argv[i + 1]) {
      manifestPath = argv[++i];
    } else if (a === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun, write, manifestPath, root };
}

function main() {
  const args = parseArgs(process.argv);
  const plan = planInboxConventionMigration(args.root);
  const manifest = {
    schema: "tesseract.inbox-convention-migration-manifest.v1",
    mode: args.write ? "write" : "dry-run",
    generatedAt: new Date().toISOString(),
    repoRoot: args.root,
    summary: plan.summary,
    renames: plan.renames,
    referenceUpdates: plan.referenceUpdates,
    collisions: plan.collisions,
  };
  const outPath =
    args.manifestPath ??
    path.join(
      args.root,
      "src/work/inbox-convention-migration/migration-manifest.dry-run.json",
    );
  if (!args.write) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(
      `[migrate-inbox-convention] dry-run manifest: ${outPath} (fileRenames=${plan.summary.plannedFileRenames})`,
    );
    return;
  }

  if (!args.manifestPath) {
    console.error(
      "[migrate-inbox-convention] refuse --write without --manifest <path>" +
        " (apply a persisted dry-run manifest verbatim; do not recompute a plan at write time). " +
        "Use migrate-timestamp-naming.mjs --write --manifest for the combined migration, " +
        "which applies an approved combined manifest including inbox steps.",
    );
    process.exitCode = 1;
    return;
  }

  const mp = path.resolve(args.manifestPath);
  if (!existsSync(mp)) {
    console.error(`[migrate-inbox-convention] missing manifest: ${mp}`);
    process.exitCode = 1;
    return;
  }
  let persisted;
  try {
    persisted = JSON.parse(readFileSync(mp, "utf8"));
  } catch (e) {
    console.error(`[migrate-inbox-convention] invalid manifest JSON: ${mp}`, e);
    process.exitCode = 1;
    return;
  }
  if (!isPersistedInboxMigrationManifest(persisted)) {
    console.error(
      `[migrate-inbox-convention] manifest schema must be tesseract.inbox-convention-migration-manifest.v1 (got ${String(/** @type {{ schema?: unknown }} */ (persisted).schema)})`,
    );
    process.exitCode = 1;
    return;
  }

  if (process.env.TESSERACT_MIGRATION_GO !== "1") {
    console.error(
      "[migrate-inbox-convention] refuse --write without TESSERACT_MIGRATION_GO=1",
    );
    process.exitCode = 1;
    return;
  }

  const renames = /** @type {Array<{ sourceRel: string, targetRel: string, kind: string }>} */ (
    persisted.renames ?? []
  );
  applyInboxRenamesFromManifest(renames, args.root);
  applyReferenceUpdatesFromManifest(
    /** @type {Array<{ file: string, before: string, after: string }>} */ (
      persisted.referenceUpdates ?? []
    ),
    args.root,
  );
  writeInboxArtifactIndex(args.root, renames);
  console.log(
    `[migrate-inbox-convention] write applied from ${mp} (TESSERACT_MIGRATION_GO=1)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
