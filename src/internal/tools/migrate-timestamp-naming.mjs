#!/usr/bin/env node
/**
 * Timestamp naming migration planner and optional writer.
 *
 * Write mode (`--write`) MUST NOT run unless the environment variable
 * `TESSERACT_MIGRATION_GO` equals `1`. This guard keeps accidental mutating
 * runs out of CI and local defaults; operators set the variable only for
 * audited post-`ship` migration commits.
 *
 * Default mode is `--dry-run`, which emits a manifest next to the active/archived
 * inbox convention migration run when that feature index exists, falling back to
 * `src/work/timestamp-naming-conventions/migration-manifest.dry-run.json`.
 *
 * Carveout: this file is intentionally excluded from ESLint via
 * `eslint.config.mjs` ignore globs for `src/internal/tools` plus `*.mjs` so helper-focused
 * scripts stay outside TypeScript-eslint parser scope.
 *
 * @see src/memory/features/timestamp-naming-conventions/spec.md (acceptance criteria, TBD-on-commit)
 */

import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** UTC instant for FDS per spec. Citation: spec.md lines 56–57 (TBD-on-commit). */
export const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);

/** SID in seconds per spec. Citation: spec.md lines 58–59 (TBD-on-commit). */
export const SID_SECONDS = 86400;

const DAY_DIR_RE = /^\d{6}_\d{2}-\d{2}-\d{2}$/;

/**
 * Returns start-of-UTC-day epoch ms for a Date.
 * @param {Date} d
 * @returns {number}
 */
export function startOfUtcDayMs(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * When the artifact day is after FDS, the Feature MUST throw because post-FDS
 * rollover is operator-deferred. Citation: spec.md deferrals (TBD-on-commit).
 * @param {Date} date
 * @returns {number} Whole UTC days from the artifact's calendar day start to FDS day start.
 */
export function daysToFds(date) {
  const start = startOfUtcDayMs(date);
  if (start > FDS_UTC_MS) {
    const err = new Error(
      "daysToFds: calendar day is after FDS; post-2500 rollover is operator-deferred",
    );
    err.code = "FDS_PLUS_ONE";
    throw err;
  }
  if (start === FDS_UTC_MS) {
    return 0;
  }
  return Math.floor((FDS_UTC_MS - start) / 86400000);
}

/**
 * Seconds remaining until the end of the UTC day (integer seconds) from UTC clock parts.
 * At 00:00:00 the value is SID (86400). At 23:59:59 the value is 1.
 * At 23:59:60 (leap-second edge) the value is 0. ECMAScript Date often normalizes
 * leap-second instants; tests call this helper directly. Citation: spec.md lines 58–59, 71–74 (TBD-on-commit).
 * @param {number} h
 * @param {number} m
 * @param {number} s
 * @returns {number}
 */
export function secondsRemainingInDayFromParts(h, m, s) {
  if (h === 23 && m === 59 && s === 60) {
    return 0;
  }
  const secSinceMidnight = h * 3600 + m * 60 + s;
  return SID_SECONDS - secSinceMidnight;
}

/**
 * @param {Date} date
 * @returns {number}
 */
export function secondsRemainingInDay(date) {
  return secondsRemainingInDayFromParts(
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
}

/**
 * HHMM token in UTC. Citation: spec.md lines 71–74 (TBD-on-commit).
 * @param {Date} date
 * @returns {string}
 */
export function hhmm(date) {
  const h = date.getUTCHours();
  const mm = date.getUTCMinutes();
  return `${String(h).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
}

/**
 * @param {Date} d
 * @returns {string} MM-DD-YY suffix for a work day directory.
 */
export function mmDdYySuffix(d) {
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mo}-${day}-${yy}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function pad6(n) {
  return String(n).padStart(6, "0");
}

/**
 * @param {string} workDirBasename
 * @returns {boolean}
 */
export function isDayDirectoryName(workDirBasename) {
  return DAY_DIR_RE.test(workDirBasename);
}

/**
 * Parses optional `created_at` / `date` from YAML-ish frontmatter.
 * @param {string} text
 * @returns {string | null}
 */
export function parseFrontmatterCreatedAt(text) {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const fm = text.slice(3, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^\s*(created_at|date)\s*:\s*(.+)\s*$/i);
    if (m) {
      return m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/**
 * Chooses authoritative instant for naming. Order: git, frontmatter, mtime, override.
 * Citation: spec.md lines 123–129 and ADR 0005 (TBD-on-commit).
 * @param {{ path: string, text?: string }} artifact
 * @param {string | null} gitIsoOldestAdd
 * @param {{ mtimeMs: number }} fsStat
 * @param {{ operatorIsoOverride?: string | null }} [ctx]
 * @returns {{ iso: string, source: 'git' | 'frontmatter' | 'mtime' | 'override' }}
 */
export function chooseTimestamp(artifact, gitIsoOldestAdd, fsStat, ctx = {}) {
  if (gitIsoOldestAdd) {
    return { iso: gitIsoOldestAdd, source: "git" };
  }
  if (artifact.text) {
    const fm = parseFrontmatterCreatedAt(artifact.text);
    if (fm) {
      const d = new Date(fm);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), source: "frontmatter" };
      }
    }
  }
  let iso = new Date(fsStat.mtimeMs).toISOString();
  let source = /** @type {'mtime' | 'override'} */ ("mtime");
  if (ctx.operatorIsoOverride) {
    iso = ctx.operatorIsoOverride;
    source = "override";
  }
  return { iso, source };
}

/**
 * Applies bare collision counters between HHMM and semantic suffix when basenames conflict.
 * Newest artifact in each collision group receives counter 0. Citation: spec.md lines 91–97 (TBD-on-commit).
 * @param {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string }>} targets
 * @returns {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string, collisionCounter: number | null }>}
 */
export function applyCollisionCounter(targets) {
  /** @type {Map<string, typeof targets>} */
  const groups = new Map();
  for (const t of targets) {
    const key = `${t.sid}_${t.hhmm}_${t.semantic}`;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string, collisionCounter: number | null }>} */
  const out = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      const [only] = group;
      out.push({ ...only, collisionCounter: null });
      continue;
    }
    const sorted = [...group].sort((a, b) => b.createdAtMs - a.createdAtMs);
    sorted.forEach((t, idx) => {
      out.push({ ...t, collisionCounter: idx });
    });
  }
  return out;
}

/**
 * Builds `{SID}_{HHMM}` or `{SID}_{HHMM}_{counter}` middle segments for basename.
 * @param {number} sid
 * @param {string} hm
 * @param {number | null} counter
 * @param {string} semantic
 * @returns {string}
 */
export function buildBasename(sid, hm, counter, semantic) {
  if (counter == null) {
    return `${sid}_${hm}_${semantic}`;
  }
  return `${sid}_${hm}_${counter}_${semantic}`;
}

/**
 * Computes planned relocation for `src/work/<task>/` (flat layout).
 * Citation: spec.md lines 60–76 (TBD-on-commit).
 * @param {string} absPath absolute path to task directory
 * @param {{ repoRoot: string, chosenDate: Date }} ctx
 * @returns {{ sourceRel: string, targetRel: string, dayDir: string, taskBasename: string }}
 */
export function migrateTargetForWorkPath(absPath, ctx) {
  const rel = path.relative(ctx.repoRoot, absPath).split(path.sep).join("/");
  const parts = rel.split("/");
  if (parts.length < 3 || parts[0] !== "src" || parts[1] !== "work") {
    throw new Error(`migrateTargetForWorkPath: expected src/work/ path, got ${rel}`);
  }
  const slug = parts[2];
  if (parts.length !== 3) {
    throw new Error(
      `migrateTargetForWorkPath: expected flat src/work/<slug>, got ${rel}`,
    );
  }
  const d = ctx.chosenDate;
  const days = daysToFds(d);
  const dayDir = `${pad6(days)}_${mmDdYySuffix(d)}`;
  const sid = secondsRemainingInDay(d);
  const hm = hhmm(d);
  const taskBasename = buildBasename(sid, hm, null, slug);
  const targetRel = `src/work/${dayDir}/${taskBasename}`;
  return { sourceRel: `${rel}/`, targetRel: `${targetRel}/`, dayDir, taskBasename };
}

/**
 * Computes planned rename for inbox files; preserves `src/inbox/threads/<feature>/` parent.
 * Citation: spec.md lines 77–84 (TBD-on-commit).
 * @param {string} absPath
 * @param {{ repoRoot: string, chosenDate: Date, collisionCounter?: number | null }} ctx
 * @returns {{ sourceRel: string, targetRel: string }}
 */
export function migrateTargetForInboxPath(absPath, ctx) {
  const rel = path.relative(ctx.repoRoot, absPath).split(path.sep).join("/");
  const parts = rel.split("/");
  if (parts.length < 3 || parts[0] !== "src" || parts[1] !== "inbox") {
    throw new Error(`migrateTargetForInboxPath: expected src/inbox/ path, got ${rel}`);
  }
  const d = ctx.chosenDate;
  const sid = secondsRemainingInDay(d);
  const hm = hhmm(d);
  const counter =
    ctx.collisionCounter === undefined ? null : ctx.collisionCounter;
  const base = path.posix.basename(rel);
  const stem = base.includes(".")
    ? base.slice(0, base.lastIndexOf("."))
    : base;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  const semantic = stem;
  const newBase = `${buildBasename(sid, hm, counter, semantic)}${ext}`;
  if (parts[2] === "threads" && parts.length >= 5) {
    const parent = parts.slice(0, -1).join("/");
    const targetRel = `${parent}/${newBase}`;
    return { sourceRel: rel, targetRel };
  }
  const parent = parts.slice(0, -1).join("/");
  const targetRel = `${parent}/${newBase}`;
  return { sourceRel: rel, targetRel };
}

/**
 * Finds occurrences of `legacyPath` in UTF-8 text files under repo scan roots.
 * False positives MUST surface as findings (no silent drop).
 * @param {string} legacyPath repo-relative POSIX path
 * @param {string} repoRoot
 * @param {string[]} [scanRoots]
 * @returns {Array<{ file: string, line: number, column: number, before: string, after: string }>}
 */
export function inventoryReferences(legacyPath, repoRoot, scanRoots) {
  const roots =
    scanRoots ??
    [
      "src/memory",
      "src/work",
      "src/inbox",
      "tests",
      "src/internal/tools",
      "src/personas",
      ".cursor",
      "src/pipelines",
      "src/skills",
    ];
  const hits = [];
  const needles = [
    legacyPath,
    legacyPath.endsWith("/") ? legacyPath.slice(0, -1) : `${legacyPath}/`,
  ];
  const fileRoots = [];
  for (const r of roots) {
    const abs = path.join(repoRoot, r);
    if (existsSync(abs)) {
      fileRoots.push(abs);
    }
  }
  for (const f of ["docs/BOOTSTRAP.md", "AGENTS.md", "docs/PRD.md"]) {
    const abs = path.join(repoRoot, f);
    if (existsSync(abs)) {
      fileRoots.push(abs);
    }
  }
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") {
          continue;
        }
        walk(p);
      } else if (e.isFile()) {
        scanFile(p);
      }
    }
  }
  /**
   * @param {string} absFile
   */
  function scanFile(absFile) {
    let buf;
    try {
      buf = readFileSync(absFile);
    } catch {
      return;
    }
    if (buf.includes(0)) {
      return;
    }
    const text = buf.toString("utf8");
    const relFile = path.relative(repoRoot, absFile).split(path.sep).join("/");
    for (const needle of needles) {
      if (!needle || !text.includes(needle)) {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let col = line.indexOf(needle);
        while (col !== -1) {
          hits.push({
            file: relFile,
            line: i + 1,
            column: col + 1,
            before: needle,
            after: needle.replace(legacyPath, "<target>"),
          });
          col = line.indexOf(needle, col + 1);
        }
      }
    }
  }
  for (const fr of fileRoots) {
    const st = statSync(fr);
    if (st.isDirectory()) {
      walk(fr);
    } else if (st.isFile()) {
      scanFile(fr);
    }
  }
  return hits;
}

/**
 * @param {string} repoRoot
 * @param {string} relPath
 * @returns {string | null}
 */
export function gitOldestAddIso(repoRoot, relPath) {
  try {
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--follow", "--format=%aI", "--", relPath],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const lines = out.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      return null;
    }
    return lines[lines.length - 1];
  } catch {
    return null;
  }
}

const EXCLUDED_SOURCES = new Set([
  "src/work/timestamp-naming-conventions/plan.md",
  "src/work/timestamp-naming-conventions/adr-draft.md",
  "src/work/timestamp-naming-conventions/touch-set.json",
  "src/inbox/in/timestamp_naming_conventions.md",
  "src/inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md",
]);

/**
 * @param {string} rel posix
 * @returns {boolean}
 */
export function isExcludedFromMigration(rel) {
  const norm = rel.replace(/\\/g, "/").replace(/\/+$/, "");
  if (EXCLUDED_SOURCES.has(norm)) {
    return true;
  }
  if (norm.endsWith("/run.log.jsonl") || norm === "run.log.jsonl") {
    return true;
  }
  if (norm.includes("/run.log.jsonl")) {
    return true;
  }
  return false;
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function listFlatWorkTasks(repoRoot) {
  const w = path.join(repoRoot, "src", "work");
  if (!existsSync(w)) {
    return [];
  }
  const out = [];
  for (const e of readdirSync(w, { withFileTypes: true })) {
    if (!e.isDirectory()) {
      continue;
    }
    if (isDayDirectoryName(e.name)) {
      continue;
    }
    const rel = `src/work/${e.name}`;
    if (isExcludedFromMigration(rel)) {
      continue;
    }
    out.push(path.join(w, e.name));
  }
  return out;
}

/**
 * @param {string} repoRoot
 * @param {string} rootRel
 * @param {string} taskId
 * @returns {string | null}
 */
function findTaskRunDir(repoRoot, rootRel, taskId) {
  const rootAbs = path.join(repoRoot, ...rootRel.split("/"));
  if (!existsSync(rootAbs)) {
    return null;
  }
  for (const day of readdirSync(rootAbs, { withFileTypes: true })) {
    if (!day.isDirectory() || !isDayDirectoryName(day.name)) {
      continue;
    }
    const candidateAbs = path.join(rootAbs, day.name, taskId);
    if (existsSync(candidateAbs) && statSync(candidateAbs).isDirectory()) {
      return path.posix.join(rootRel, day.name, taskId);
    }
  }
  return null;
}

/**
 * The inbox convention migration owns the current inbox tree rewrite. When that
 * feature has been closed, default dry-run manifests should live with its
 * archived run artifacts rather than recreating the deprecated active work path.
 *
 * @param {string} repoRoot
 * @returns {string | null}
 */
function inboxConventionRunDir(repoRoot) {
  const indexPath = path.join(
    repoRoot,
    "src",
    "memory",
    "features",
    "inbox-convention-migration",
    "index.json",
  );
  if (!existsSync(indexPath)) {
    return null;
  }
  let taskId = null;
  try {
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    taskId = typeof index.taskId === "string" ? index.taskId : null;
  } catch {
    return null;
  }
  if (!taskId) {
    return null;
  }
  return (
    findTaskRunDir(repoRoot, "src/internal/work_archive", taskId) ??
    findTaskRunDir(repoRoot, "src/work", taskId)
  );
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
export function defaultManifestPath(repoRoot) {
  const runDir = inboxConventionRunDir(repoRoot);
  if (runDir) {
    return path.join(repoRoot, ...runDir.split("/"), "migration-manifest.dry-run.json");
  }
  return path.join(
    repoRoot,
    "src/work/timestamp-naming-conventions/migration-manifest.dry-run.json",
  );
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} dest
 */
export function writeManifest(manifest, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  let dryRun = true;
  let write = false;
  let rollback = false;
  /** @type {string | null} */
  let manifestPath = null;
  let root = path.resolve(__dirname, "..", "..", "..");
  let strictReferences = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      write = false;
    } else if (a === "--write") {
      write = true;
      dryRun = false;
    } else if (a === "--rollback") {
      rollback = true;
    } else if (a === "--strict-references") {
      strictReferences = true;
    } else if (a === "--manifest" && argv[i + 1]) {
      manifestPath = argv[++i];
    } else if (a === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun, write, rollback, manifestPath, root, strictReferences };
}

/**
 * @param {{ repoRoot: string, strictReferences: boolean }} opts
 */
async function buildDryRunManifest(opts) {
  const { planInboxConventionMigration } = await import("./migrate-inbox-convention.mjs");
  const inboxPlan = planInboxConventionMigration(opts.repoRoot);
  const { repoRoot, strictReferences } = opts;
  const workTasks = listFlatWorkTasks(repoRoot);

  /** @type {Array<{ sourceRel: string, targetRel: string, kind: string, timestamp: { iso: string, source: string } }>} */
  const workRenames = [];
  /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string }>} */
  const collisionInputs = [];

  for (const abs of workTasks) {
    const relDir = path.relative(repoRoot, abs).split(path.sep).join("/") + "/";
    let text = "";
    try {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.isFile() && e.name === "plan.md") {
          text = readFileSync(path.join(abs, e.name), "utf8");
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const gitIso = gitOldestAddIso(repoRoot, relDir.replace(/\/$/, ""));
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const chosen = chooseTimestamp(
      { path: relDir, text },
      gitIso,
      { mtimeMs: st.mtimeMs },
    );
    const d = new Date(chosen.iso);
    const sid = secondsRemainingInDay(d);
    const hm = hhmm(d);
    const slug = path.posix.basename(relDir.replace(/\/$/, ""));
    collisionInputs.push({
      id: relDir,
      createdAtMs: d.getTime(),
      sid,
      hhmm: hm,
      semantic: slug,
    });
  }

  const withCols = applyCollisionCounter(collisionInputs);
  const byId = new Map(withCols.map((t) => [t.id, t]));

  for (const abs of workTasks) {
    const relDir = path.relative(repoRoot, abs).split(path.sep).join("/") + "/";
    let text = "";
    try {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.isFile() && e.name === "plan.md") {
          text = readFileSync(path.join(abs, e.name), "utf8");
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const gitIso = gitOldestAddIso(repoRoot, relDir.replace(/\/$/, ""));
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const chosen = chooseTimestamp(
      { path: relDir, text },
      gitIso,
      { mtimeMs: st.mtimeMs },
    );
    const d = new Date(chosen.iso);
    const col = byId.get(relDir);
    if (!col) {
      continue;
    }
    const days = daysToFds(d);
    const dayDir = `${pad6(days)}_${mmDdYySuffix(d)}`;
    const taskBasename = buildBasename(
      col.sid,
      col.hhmm,
      col.collisionCounter,
      col.semantic,
    );
    const targetRel = `src/work/${dayDir}/${taskBasename}/`;
    workRenames.push({
      sourceRel: relDir,
      targetRel,
      kind: "work-task-dir",
      timestamp: { iso: chosen.iso, source: chosen.source },
    });
  }

  const renames = [...workRenames, ...inboxPlan.renames];

  /** @type {Array<{ file: string, line: number, column: number, jsonPointer: string | null, before: string, after: string }>} */
  const referenceUpdates = [];
  for (const r of workRenames) {
    const legacy = r.sourceRel.replace(/\/$/, "");
    const hits = inventoryReferences(legacy, repoRoot);
    const target = r.targetRel.replace(/\/$/, "");
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
  referenceUpdates.push(...inboxPlan.referenceUpdates);

  /** @type {string[]} */
  const collisions = [];
  const seen = new Map();
  for (const r of renames) {
    if (r.kind === "inbox-remove-empty-dir") {
      continue;
    }
    const t = r.targetRel.replace(/\/$/, "");
    const c = seen.get(t) ?? 0;
    seen.set(t, c + 1);
    if (c >= 1) {
      collisions.push(`duplicate target ${t}`);
    }
  }

  const manifest = {
    schema: "tesseract.timestamp-migration-manifest.v1",
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    repoRoot,
    summary: {
      plannedRenames: renames.length,
      plannedWorkTaskDirs: workRenames.length,
      inboxConvention: inboxPlan.summary,
      referenceUpdateRows: referenceUpdates.length,
      collisionWarnings: collisions.length,
    },
    renames,
    referenceUpdates,
    collisions,
  };

  if (strictReferences) {
    const stale = [];
    for (const r of renames) {
      if (r.kind === "inbox-remove-empty-dir") {
        continue;
      }
      const legacy =
        r.kind === "work-task-dir"
          ? r.sourceRel.replace(/\/$/, "")
          : r.sourceRel;
      const scan = inventoryReferences(legacy, repoRoot);
      for (const h of scan) {
        const covered = referenceUpdates.some(
          (u) =>
            u.file === h.file &&
            u.line === h.line &&
            u.column === h.column &&
            u.before === h.before,
        );
        if (!covered) {
          stale.push({ ...h, legacy });
        }
      }
    }
    manifest.strictReferenceAudit = { staleRows: stale };
    if (stale.length > 0) {
      console.error(
        `[migrate-timestamp-naming] strict-references: ${stale.length} uncovered legacy hits`,
      );
    }
  }

  return manifest;
}

/**
 * @param {Array<{ sourceRel: string, targetRel: string, kind: string }>} renames
 * @param {string} repoRoot
 */
export function applyRenamesFromManifest(renames, repoRoot) {
  const ordered = [...renames].filter((r) => r.kind === "work-task-dir");
  for (const r of ordered) {
    const fromRel = r.sourceRel.replace(/\/+$/, "");
    const toRel = r.targetRel.replace(/\/+$/, "");
    const fromAbs = path.join(repoRoot, fromRel);
    const toAbs = path.join(repoRoot, toRel);
    const toParent = path.dirname(toAbs);
    mkdirSync(toParent, { recursive: true });
    renameSync(fromAbs, toAbs);
  }
}

/**
 * @param {Array<{ file: string, before: string, after: string }>} referenceUpdates
 * @param {string} repoRoot
 */
export function applyReferenceUpdatesFromManifest(referenceUpdates, repoRoot) {
  /** @type {Map<string, Map<string, string>>} */
  const byFile = new Map();
  for (const u of referenceUpdates) {
    const abs = path.join(repoRoot, u.file);
    const m = byFile.get(abs) ?? new Map();
    m.set(u.before, u.after);
    byFile.set(abs, m);
  }
  for (const [abs, pairs] of byFile) {
    let text = readFileSync(abs, "utf8");
    const sorted = [...pairs.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    );
    for (const [before, after] of sorted) {
      text = text.split(before).join(after);
    }
    writeFileSync(abs, text, "utf8");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = args.root;
  const defaultManifest = defaultManifestPath(repoRoot);

  if (args.rollback) {
    const mp = args.manifestPath
      ? path.resolve(args.manifestPath)
      : defaultManifest;
    if (!existsSync(mp)) {
      console.error(`[migrate-timestamp-naming] missing manifest: ${mp}`);
      process.exitCode = 1;
      return;
    }
    const m = JSON.parse(readFileSync(mp, "utf8"));
    const back = (m.renames ?? [])
      .filter((/** @type {{ kind?: string }} */ r) => r.kind !== "inbox-remove-empty-dir")
      .map((/** @type {{ sourceRel: string, targetRel: string }} */ r) => ({
        from: r.targetRel,
        to: r.sourceRel,
      }));
    console.log(
      JSON.stringify({ rollbackPlanned: back.length, steps: back }, null, 2),
    );
    return;
  }

  if (args.write) {
    if (process.env.TESSERACT_MIGRATION_GO !== "1") {
      console.error(
        "[migrate-timestamp-naming] refuse --write without TESSERACT_MIGRATION_GO=1",
      );
      process.exitCode = 1;
      return;
    }
    const mp = args.manifestPath
      ? path.resolve(args.manifestPath)
      : defaultManifest;
    if (!existsSync(mp)) {
      console.error(`[migrate-timestamp-naming] missing manifest: ${mp}`);
      process.exitCode = 1;
      return;
    }
    const m = JSON.parse(readFileSync(mp, "utf8"));
    const renames = /** @type {[]} */ (m.renames ?? []);
    applyRenamesFromManifest(renames, repoRoot);
    applyReferenceUpdatesFromManifest(
      /** @type {[]} */ (m.referenceUpdates ?? []),
      repoRoot,
    );
    const inboxMod = await import("./migrate-inbox-convention.mjs");
    inboxMod.applyInboxRenamesFromManifest(renames, repoRoot);
    inboxMod.writeInboxArtifactIndex(repoRoot, renames);
    console.log(
      `[migrate-timestamp-naming] write applied from ${mp} (TESSERACT_MIGRATION_GO=1)`,
    );
    return;
  }

  const manifest = await buildDryRunManifest({
    repoRoot,
    strictReferences: args.strictReferences,
  });
  const outPath = args.manifestPath
    ? path.resolve(args.manifestPath)
    : defaultManifest;
  writeManifest(manifest, outPath);
  console.log(
    `[migrate-timestamp-naming] dry-run manifest: ${outPath} (renames=${manifest.summary.plannedRenames}, referenceUpdates=${manifest.summary.referenceUpdateRows})`,
  );
  const staleN = manifest.strictReferenceAudit?.staleRows?.length ?? 0;
  if (args.strictReferences && staleN > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
