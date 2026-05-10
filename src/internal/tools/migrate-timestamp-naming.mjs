#!/usr/bin/env node
/**
 * Timestamp naming migration planner and optional writer.
 *
 * Write mode (`--write`) MUST NOT run unless the environment variable
 * `TESSERACT_MIGRATION_GO` equals `1`. This guard keeps accidental mutating
 * runs out of CI and local defaults; operators set the variable only for
 * audited post-`ship` migration commits.
 *
 * Default mode is `--dry-run`, which emits
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
 * @returns {string[]}
 */
function listInboxFiles(repoRoot) {
  /** @type {string[]} */
  const files = [];
  const patterns = [
    ["src", "inbox", "in"],
    ["src", "inbox", "out"],
    ["src", "inbox", "archive", "in"],
  ];
  for (const segs of patterns) {
    const dir = path.join(repoRoot, ...segs);
    if (!existsSync(dir)) {
      continue;
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) {
        const rel = [...segs, e.name].join("/");
        if (!isExcludedFromMigration(rel)) {
          files.push(path.join(dir, e.name));
        }
      }
    }
  }
  const threads = path.join(repoRoot, "src", "inbox", "threads");
  if (existsSync(threads)) {
    for (const feat of readdirSync(threads, { withFileTypes: true })) {
      if (!feat.isDirectory()) {
        continue;
      }
      const d = path.join(threads, feat.name);
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isFile()) {
          const rel = `src/inbox/threads/${feat.name}/${e.name}`;
          if (!isExcludedFromMigration(rel)) {
            files.push(path.join(d, e.name));
          }
        }
      }
    }
  }
  return files;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} dest
 */
function writeManifest(manifest, dest) {
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
function buildDryRunManifest(opts) {
  const { repoRoot, strictReferences } = opts;
  const workTasks = listFlatWorkTasks(repoRoot);
  const inboxFiles = listInboxFiles(repoRoot);

  /** @type {Array<{ sourceRel: string, targetRel: string, kind: string, timestamp: { iso: string, source: string } }>} */
  const renames = [];
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
    renames.push({
      sourceRel: relDir,
      targetRel,
      kind: "work-task-dir",
      timestamp: { iso: chosen.iso, source: chosen.source },
    });
  }

  /** @type {Map<string, Array<{ abs: string, rel: string, chosen: ReturnType<typeof chooseTimestamp>, d: Date }>>} */
  const inboxByParent = new Map();
  for (const abs of inboxFiles) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const text = readFileSync(abs, "utf8");
    const gitIso = gitOldestAddIso(repoRoot, rel);
    const st = statSync(abs);
    const chosen = chooseTimestamp(
      { path: rel, text },
      gitIso,
      { mtimeMs: st.mtimeMs },
    );
    const d = new Date(chosen.iso);
    const parent = path.posix.dirname(rel);
    const g = inboxByParent.get(parent) ?? [];
    g.push({ abs, rel, chosen, d });
    inboxByParent.set(parent, g);
  }
  for (const [, group] of inboxByParent) {
    /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string }>} */
    const ic = [];
    for (const item of group) {
      const base = path.posix.basename(item.rel);
      const stem = base.includes(".")
        ? base.slice(0, base.lastIndexOf("."))
        : base;
      const sid = secondsRemainingInDay(item.d);
      const hm = hhmm(item.d);
      ic.push({
        id: item.rel,
        createdAtMs: item.d.getTime(),
        sid,
        hhmm: hm,
        semantic: stem,
      });
    }
    const resolved = applyCollisionCounter(ic);
    const byRel = new Map(resolved.map((t) => [t.id, t]));
    for (const item of group) {
      const col = byRel.get(item.rel);
      if (!col) {
        continue;
      }
      const ctx = {
        repoRoot,
        chosenDate: item.d,
        collisionCounter: col.collisionCounter,
      };
      const { targetRel } = migrateTargetForInboxPath(item.abs, ctx);
      renames.push({
        sourceRel: item.rel,
        targetRel,
        kind: "inbox-file",
        timestamp: { iso: item.chosen.iso, source: item.chosen.source },
      });
    }
  }

  /** @type {Map<string, string>} */
  const pathMap = new Map();
  for (const r of renames) {
    const from = r.sourceRel.replace(/\/$/, "");
    const to = r.targetRel.replace(/\/$/, "");
    pathMap.set(from, to);
    if (r.kind === "work-task-dir") {
      pathMap.set(`${from}/`, `${to}/`);
    }
  }

  /** @type {Array<{ file: string, line: number, column: number, jsonPointer: string | null, before: string, after: string }>} */
  const referenceUpdates = [];
  for (const r of renames) {
    const legacy =
      r.kind === "work-task-dir"
        ? r.sourceRel.replace(/\/$/, "")
        : r.sourceRel;
    const hits = inventoryReferences(legacy, repoRoot);
    const target =
      r.kind === "work-task-dir"
        ? r.targetRel.replace(/\/$/, "")
        : r.targetRel;
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
  const ordered = [...renames].sort((a, b) => {
    if (a.kind === b.kind) {
      return 0;
    }
    return a.kind === "work-task-dir" ? -1 : 1;
  });
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

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = args.root;
  const defaultManifest = path.join(
    repoRoot,
    "src/work/timestamp-naming-conventions/migration-manifest.dry-run.json",
  );

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
    const back = (m.renames ?? []).map((/** @type {{ sourceRel: string, targetRel: string }} */ r) => ({
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
    applyRenamesFromManifest(/** @type {[]} */ (m.renames ?? []), repoRoot);
    applyReferenceUpdatesFromManifest(
      /** @type {[]} */ (m.referenceUpdates ?? []),
      repoRoot,
    );
    console.log(
      `[migrate-timestamp-naming] write applied from ${mp} (TESSERACT_MIGRATION_GO=1)`,
    );
    return;
  }

  const manifest = buildDryRunManifest({
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
  main();
}
