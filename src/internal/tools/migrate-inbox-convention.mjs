#!/usr/bin/env node
/**
 * Inbox convention migration: day buckets with A1 single-file leaves (no per-artifact
 * task subdirectories). Threads use A2 layout: `threads/<day>/<feature>/<basename>.md`.
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
  parseFrontmatterCreatedAt,
  stripInboxTimestampPrefix,
  defaultManifestPath,
} from "./migrate-timestamp-naming.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Work-style day directory basename pattern (UTC). */
const DAY_DIR_RE = /^\d{6}_\d{2}-\d{2}-\d{2}$/;

/** In-scope inbox queue roots for orphan empty-directory pruning (`notes/` excluded). */
const INBOX_PRUNE_ROOTS = /** @type {const} */ ([
  ["src", "inbox", "in"],
  ["src", "inbox", "out"],
  ["src", "inbox", "archive", "in"],
  ["src", "inbox", "threads"],
]);

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
 * Parses `YYYY-MM-DDTHH-MM-SSZ` (or colon form) embedded in a filename stem.
 * @param {string} stem
 * @returns {string | null} ISO-8601 instant
 */
export function parseIsoTimestampFromStem(stem) {
  const m = stem.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)/iu);
  if (!m) {
    return null;
  }
  return m[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})Z$/iu,
    "T$1:$2:$3Z",
  );
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseFrontmatterPostedAt(text) {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const fm = text.slice(3, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^\s*posted_at_utc\s*:\s*(.+)\s*$/i);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/**
 * Inbox naming instant: filename ISO and frontmatter precede git so remigration
 * does not reuse rename-commit timestamps.
 * @param {{ path: string, text?: string, sourceText?: string, sourcePath?: string }} artifact
 * @param {string | null} gitIsoOldestAdd
 * @param {{ mtimeMs: number }} fsStat
 * @param {{ operatorIsoOverride?: string | null, repoRoot?: string, featureSlug?: string }} [ctx]
 * @returns {{ iso: string, source: string }}
 */
export function chooseInboxNamingInstant(artifact, gitIsoOldestAdd, fsStat, ctx = {}) {
  if (ctx.operatorIsoOverride) {
    return { iso: ctx.operatorIsoOverride, source: "override" };
  }
  const base = path.posix.basename(artifact.path);
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const isoInStem = parseIsoTimestampFromStem(stem);
  if (isoInStem) {
    const d = new Date(isoInStem);
    if (!Number.isNaN(d.getTime())) {
      return { iso: d.toISOString(), source: "filename-iso" };
    }
  }
  if (artifact.sourcePath) {
    const sourceStem = path.posix.basename(artifact.sourcePath);
    const sourceBase = sourceStem.includes(".")
      ? sourceStem.slice(0, sourceStem.lastIndexOf("."))
      : sourceStem;
    const isoInSource = parseIsoTimestampFromStem(sourceBase);
    if (isoInSource) {
      const d = new Date(isoInSource);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), source: "source-filename-iso" };
      }
    }
  }
  const bodyText = artifact.text ?? "";
  if (bodyText) {
    const pipelineIso = parseFrontmatterPipelineTaskInstant(
      bodyText,
      ctx.repoRoot ?? "",
    );
    if (pipelineIso) {
      const d = new Date(pipelineIso);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), source: "frontmatter-pipeline-task" };
      }
    }
    const fm =
      parseFrontmatterCreatedAt(bodyText) ?? parseFrontmatterPostedAt(bodyText);
    if (fm) {
      const d = new Date(fm);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), source: "frontmatter" };
      }
    }
  }
  if (ctx.featureSlug && ctx.repoRoot) {
    const intakeIso = findFeatureIntakeIso(ctx.repoRoot, ctx.featureSlug);
    if (intakeIso) {
      const d = new Date(intakeIso);
      if (!Number.isNaN(d.getTime())) {
        return { iso: d.toISOString(), source: "feature-intake-iso" };
      }
    }
  }
  if (gitIsoOldestAdd) {
    return { iso: gitIsoOldestAdd, source: "git" };
  }
  let iso = new Date(fsStat.mtimeMs).toISOString();
  let source = "mtime";
  if (ctx.operatorIsoOverride) {
    iso = ctx.operatorIsoOverride;
    source = "override";
  }
  return { iso, source };
}

/**
 * Semantic suffix for inbox leaf basenames (not task-directory names).
 * @param {string} fileStem
 * @returns {string}
 */
export function buildInboxLeafSemantic(fileStem) {
  let s = stripInboxTimestampPrefix(fileStem);
  s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-?/giu, "");
  s = s.replace(/^\d{4}-\d{2}-\d{2}[-_]\d{2}[-_]\d{2}[-_]\d{2}Z-?/giu, "");
  return normalizeInboxSemanticStem(s);
}

/**
 * @param {string} stem
 * @returns {{ sid: number, hhmm: string, counter: number | null } | null}
 */
export function parseTimestampTokensFromStem(stem) {
  const m = stem.match(/^(\d+)_(\d{4})(?:_(\d+))?_/u);
  if (!m) {
    return null;
  }
  return {
    sid: Number(m[1]),
    hhmm: m[2],
    counter: m[3] != null ? Number(m[3]) : null,
  };
}

/**
 * @param {string} rel
 * @param {'in' | 'out' | 'archive-in' | 'threads'} queue
 * @returns {boolean}
 */
export function isCanonicalInboxPath(rel, queue) {
  const parts = rel.split("/");
  if (queue === "threads") {
    if (parts.length !== 6) {
      return false;
    }
    if (!DAY_DIR_RE.test(parts[3])) {
      return false;
    }
    if (isMigratedThreadTaskSegment(parts[4])) {
      return false;
    }
    const stem = parts[5].includes(".")
      ? parts[5].slice(0, parts[5].lastIndexOf("."))
      : parts[5];
    return stemHasTimestampPrefix(stem);
  }
  const dayIdx = queue === "archive-in" ? 4 : 3;
  const fileIdx = dayIdx + 1;
  if (parts.length !== fileIdx + 1) {
    return false;
  }
  if (!DAY_DIR_RE.test(parts[dayIdx])) {
    return false;
  }
  const stem = parts[fileIdx].includes(".")
    ? parts[fileIdx].slice(0, parts[fileIdx].lastIndexOf("."))
    : parts[fileIdx];
  return stemHasTimestampPrefix(stem);
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
    const m = line.match(/^\s*feature[-_]id\s*:\s*(.+)\s*$/i);
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

/**
 * Derives a UTC instant from `pipeline-task-id: {SID}_{HHMM}_…` plus optional
 * `src/work/<day-dir>/` reference in the same frontmatter block.
 * @param {string} text
 * @returns {string | null} ISO-8601 instant
 */
/**
 * @param {string} repoRoot
 * @param {string} taskId e.g. `67055_0522_json-formatting`
 * @returns {string | null} day directory basename
 */
export function resolveWorkDayDirForPipelineTask(repoRoot, taskId) {
  for (const rootRel of ["src/work", "src/internal/work_archive"]) {
    const work = path.join(repoRoot, ...rootRel.split("/"));
    if (!existsSync(work)) {
      continue;
    }
    for (const day of readdirSync(work, { withFileTypes: true })) {
      if (!day.isDirectory() || !DAY_DIR_RE.test(day.name)) {
        continue;
      }
      if (existsSync(path.join(work, day.name, taskId))) {
        return day.name;
      }
    }
  }
  return null;
}

export function parseFrontmatterPipelineTaskInstant(text, repoRoot = "") {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const fm = text.slice(3, end);
  const taskLine = fm.match(/^\s*pipeline-task-id:\s*(\S+)/m);
  if (!taskLine) {
    return null;
  }
  const taskId = taskLine[1].trim();
  const taskMatch = taskId.match(/^(\d+)_(\d{4})_/u);
  if (!taskMatch) {
    return null;
  }
  const dayDir =
    fm.match(/src\/work\/(\d{6}_\d{2}-\d{2}-\d{2})\//)?.[1] ??
    (repoRoot ? resolveWorkDayDirForPipelineTask(repoRoot, taskId) : null);
  if (!dayDir) {
    return null;
  }
  const dayParts = dayDir.match(/^\d{6}_(\d{2})-(\d{2})-(\d{2})$/u);
  if (!dayParts) {
    return null;
  }
  const yy = Number(dayParts[3]);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const month = Number(dayParts[1]) - 1;
  const day = Number(dayParts[2]);
  const hour = Number(taskMatch[2].slice(0, 2));
  const minute = Number(taskMatch[2].slice(2, 4));
  const d = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/**
 * Reads `source.path` from YAML frontmatter when present.
 * @param {string} text
 * @returns {string | null}
 */
export function parseFrontmatterSourceInboxPath(text) {
  if (!text.startsWith("---")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const fm = text.slice(3, end);
  const m = fm.match(/^\s*path:\s*(src\/inbox\/[^\s#]+)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * @param {string} repoRoot
 * @param {string} sourceRel
 * @returns {string | null}
 */
/**
 * @param {string} repoRoot
 * @param {string} featureSlug
 * @returns {string | null}
 */
export function findFeatureIntakeIso(repoRoot, featureSlug) {
  const roots = [
    path.join(repoRoot, "src", "inbox", "in"),
    path.join(repoRoot, "src", "inbox", "archive", "in"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    /** @param {string} dirAbs */
    const walk = (dirAbs) => {
      for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
        if (e.name.startsWith(".")) {
          continue;
        }
        const full = path.join(dirAbs, e.name);
        if (e.isDirectory()) {
          const found = walk(full);
          if (found) {
            return found;
          }
        } else if (
          e.isFile() &&
          e.name.includes(featureSlug) &&
          /intake/iu.test(e.name)
        ) {
          const stem = e.name.replace(/\.[^.]+$/u, "");
          const iso = parseIsoTimestampFromStem(stem);
          if (iso) {
            return iso;
          }
        }
      }
      return null;
    };
    const hit = walk(root);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function readInboxSourceText(repoRoot, sourceRel) {
  const direct = path.join(repoRoot, sourceRel);
  if (existsSync(direct)) {
    try {
      return readFileSync(direct, "utf8");
    } catch {
      /* ignore */
    }
  }
  const base = path.posix.basename(sourceRel);
  const archiveRoot = path.join(repoRoot, "src", "inbox", "archive", "in");
  if (!existsSync(archiveRoot)) {
    return null;
  }
  /** @param {string} dirAbs */
  const walk = (dirAbs) => {
    for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) {
          return found;
        }
      } else if (e.isFile() && e.name === base) {
        try {
          return readFileSync(full, "utf8");
        } catch {
          return null;
        }
      }
    }
    return null;
  };
  return walk(archiveRoot);
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
    .replace(/^\d+_\d{4}(?:_\d+)?_/u, "")
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
 * Lists every non-canonical inbox artifact (legacy flat paths and wrongly nested
 * task-subdirectory layouts from the first migration pass).
 * @param {string} repoRoot
 * @returns {Array<{ abs: string, rel: string, queue: 'in' | 'out' | 'archive-in' | 'threads', threadFeatureId: string | null }>}
 */
export function listInboxArtifactRows(repoRoot) {
  /** @type {Array<{ abs: string, rel: string, queue: 'in' | 'out' | 'archive-in' | 'threads', threadFeatureId: string | null }>} */
  const out = [];

  const roots = /** @type {const} */ ([
    { queue: "in", segs: ["src", "inbox", "in"] },
    { queue: "out", segs: ["src", "inbox", "out"] },
    { queue: "archive-in", segs: ["src", "inbox", "archive", "in"] },
    { queue: "threads", segs: ["src", "inbox", "threads"] },
  ]);

  /**
   * @param {string} dirAbs
   * @param {string[]} relParts
   * @param {'in' | 'out' | 'archive-in' | 'threads'} queue
   * @param {string | null} threadFeatureId
   */
  const walk = (dirAbs, relParts, queue, threadFeatureId) => {
    for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === ".gitkeep") {
        continue;
      }
      const rel = [...relParts, e.name].join("/");
      if (rel.includes("/notes/") || rel.endsWith("/notes")) {
        continue;
      }
      if (e.isDirectory()) {
        walk(path.join(dirAbs, e.name), [...relParts, e.name], queue, threadFeatureId);
      } else if (e.isFile()) {
        if (isExcludedFromMigration(rel) || isCanonicalInboxPath(rel, queue)) {
          continue;
        }
        out.push({
          abs: path.join(dirAbs, e.name),
          rel,
          queue,
          threadFeatureId,
        });
      }
    }
  };

  for (const { queue, segs } of roots) {
    const dir = path.join(repoRoot, ...segs);
    if (!existsSync(dir)) {
      continue;
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === ".gitkeep") {
        continue;
      }
      const rel = [...segs, e.name].join("/");
      if (rel.includes("/notes/") || rel.endsWith("/notes")) {
        continue;
      }
      if (e.isFile()) {
        if (!isExcludedFromMigration(rel) && !isCanonicalInboxPath(rel, queue)) {
          out.push({
            abs: path.join(dir, e.name),
            rel,
            queue,
            threadFeatureId: null,
          });
        }
        continue;
      }
      if (!e.isDirectory()) {
        continue;
      }
      const threadFeatureId =
        queue === "threads" && !DAY_DIR_RE.test(e.name) ? e.name : null;
      walk(path.join(dir, e.name), [...segs, e.name], queue, threadFeatureId);
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** @deprecated Use {@link listInboxArtifactRows}; kept for tests and callers. */
export function listLegacyInboxArtifactRows(repoRoot) {
  return listInboxArtifactRows(repoRoot);
}

/**
 * @param {typeof listLegacyInboxArtifactRows extends (...args: infer R) => infer T ? T extends Array<infer U> ? U : never : never} row
 * @param {string} text
 * @returns {string}
 */
function resolveFeatureIdForRow(row, text) {
  const fm = parseFrontmatterFeatureId(text);
  if (fm) {
    return slugFeatureId(fm);
  }
  if (row.threadFeatureId && !DAY_DIR_RE.test(row.threadFeatureId)) {
    return slugFeatureId(row.threadFeatureId);
  }
  const parts = row.rel.split("/");
  if (row.queue === "threads" && parts.length >= 6) {
    const seg = parts[4];
    if (!isMigratedThreadTaskSegment(seg)) {
      return slugFeatureId(seg);
    }
    const semantic = stripInboxTimestampPrefix(seg);
    const roundIdx = semantic.indexOf("_round");
    if (roundIdx > 0) {
      return slugFeatureId(semantic.slice(0, roundIdx));
    }
    const underscore = semantic.indexOf("_");
    if (underscore > 0) {
      return slugFeatureId(semantic.slice(0, underscore));
    }
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
  const rows = listInboxArtifactRows(repoRoot);

  /** @type {Array<{ rel: string, queue: string, threadFeatureId: string | null, chosen: { iso: string, source: string }, d: Date, featureId: string, fileStem: string, ext: string, dayDir: string, sid: number, hm: string, leafSemantic: string, parentKey: string, preserveExistingPrefix: boolean, existingCounter: number | null }>} */
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
    let textForSource = text;
    const sourceInboxPath = parseFrontmatterSourceInboxPath(text);
    if (sourceInboxPath) {
      const srcText = readInboxSourceText(repoRoot, sourceInboxPath);
      if (srcText) {
        textForSource = srcText;
      }
    }
    const gitIso =
      gitOldestAddIso(repoRoot, row.rel, { follow: false }) ??
      gitOldestAddIso(repoRoot, row.rel);
    let st;
    try {
      st = statSync(row.abs);
    } catch {
      continue;
    }
    const base = path.posix.basename(row.rel);
    const fileStem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
    const featureId = resolveFeatureIdForRow(row, text);
    const chosen = chooseInboxNamingInstant(
      {
        path: row.rel,
        text,
        sourceText: textForSource !== text ? textForSource : undefined,
        sourcePath:
          sourceInboxPath && textForSource !== text ? sourceInboxPath : undefined,
      },
      gitIso,
      { mtimeMs: st.mtimeMs },
      {
        operatorIsoOverride: operatorIsoByRel[row.rel] ?? null,
        repoRoot,
        featureSlug: slugFeatureId(featureId),
      },
    );
    const d = new Date(chosen.iso);
    const leafSemantic = buildInboxLeafSemantic(fileStem);
    const days = daysToFds(d);
    const dayDir = `${pad6(days)}_${mmDdYySuffix(d)}`;
    const preserveExistingPrefix =
      stemHasTimestampPrefix(fileStem) &&
      ![
        "filename-iso",
        "source-filename-iso",
        "frontmatter",
        "frontmatter-pipeline-task",
        "feature-intake-iso",
      ].includes(chosen.source);
    const parsedTokens = parseTimestampTokensFromStem(fileStem);
    const sid =
      preserveExistingPrefix && parsedTokens
        ? parsedTokens.sid
        : secondsRemainingInDay(d);
    const hm =
      preserveExistingPrefix && parsedTokens ? parsedTokens.hhmm : hhmm(d);
    const prefix = queuePrefixSegments(
      /** @type {'in' | 'out' | 'archive-in' | 'threads'} */ (row.queue),
    );
    const parentKey =
      row.queue === "threads"
        ? [...prefix, dayDir, slugFeatureId(featureId)].join("/")
        : [...prefix, dayDir].join("/");

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
      leafSemantic,
      parentKey,
      preserveExistingPrefix,
      existingCounter: parsedTokens?.counter ?? null,
    });
  }

  /** Leaf-basename collision groups within the same day bucket (and feature folder for threads). */
  /** @type {Array<{ id: string, createdAtMs: number, sid: number, hhmm: string, semantic: string, parentKey: string }>} */
  const leafCollisionInputs = enriched.map((e) => ({
    id: e.rel,
    createdAtMs: e.d.getTime(),
    sid: e.sid,
    hhmm: e.hm,
    semantic: e.leafSemantic,
    parentKey: e.parentKey,
  }));
  /** @type {Map<string, typeof leafCollisionInputs>} */
  const byParent = new Map();
  for (const ic of leafCollisionInputs) {
    const key = `${ic.parentKey}\0${ic.sid}_${ic.hhmm}_${ic.semantic}`;
    const g = byParent.get(key) ?? [];
    g.push(ic);
    byParent.set(key, g);
  }
  /** @type {Map<string, number | null>} */
  const leafCounterByRel = new Map();
  for (const [, group] of byParent) {
    const resolved = applyCollisionCounter(group);
    for (const r of resolved) {
      leafCounterByRel.set(r.id, r.collisionCounter);
    }
  }

  /** @type {Array<{ sourceRel: string, targetRel: string, kind: string, timestamp: { iso: string, source: string } }>} */
  const renames = [];
  /** @type {Set<string>} */
  const dirsToDrop = new Set();

  for (const e of enriched) {
    const leafBasename = buildBasename(
      e.sid,
      e.hm,
      e.preserveExistingPrefix
        ? (e.existingCounter ?? leafCounterByRel.get(e.rel) ?? null)
        : (leafCounterByRel.get(e.rel) ?? null),
      e.leafSemantic,
    );
    const leaf = `${leafBasename}${e.ext}`;
    const prefix = queuePrefixSegments(
      /** @type {'in' | 'out' | 'archive-in' | 'threads'} */ (e.queue),
    );
    const targetRel =
      e.queue === "threads"
        ? [...prefix, e.dayDir, slugFeatureId(e.featureId), leaf].join("/")
        : [...prefix, e.dayDir, leaf].join("/");
    renames.push({
      sourceRel: e.rel,
      targetRel,
      kind: "inbox-nested-file",
      timestamp: { iso: e.chosen.iso, source: e.chosen.source },
    });

    const sourceParts = e.rel.split("/");
    if (e.queue === "threads" && sourceParts.length > 4) {
      for (let i = 4; i < sourceParts.length - 1; i++) {
        dirsToDrop.add(sourceParts.slice(0, i + 1).join("/") + "/");
      }
      if (e.threadFeatureId && !DAY_DIR_RE.test(e.threadFeatureId)) {
        dirsToDrop.add(path.posix.join("src/inbox/threads", e.threadFeatureId) + "/");
      }
    } else if (e.queue !== "threads") {
      const dayIdx = e.queue === "archive-in" ? 4 : 3;
      for (let i = dayIdx + 1; i < sourceParts.length - 1; i++) {
        dirsToDrop.add(sourceParts.slice(0, i + 1).join("/") + "/");
      }
    }
  }

  for (const dirRel of [...dirsToDrop].sort((a, b) => b.length - a.length)) {
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
      threadFeatureDirsRemoved: dirsToDrop.size,
    },
  };
}

/**
 * @param {string} dirAbs
 * @returns {boolean}
 */
function directoryIsEffectivelyEmpty(dirAbs) {
  try {
    const entries = readdirSync(dirAbs);
    return entries.every((name) => name === ".gitkeep");
  } catch {
    return false;
  }
}

/**
 * @param {string} dirAbs
 * @param {string[]} relParts
 * @param {Set<string>} virtuallyRemoved
 * @returns {boolean}
 */
function directoryIsEmptyForPrune(dirAbs, relParts, virtuallyRemoved) {
  try {
    const entries = readdirSync(dirAbs).filter((name) => !name.startsWith("."));
    if (entries.length === 0) {
      return true;
    }
    return entries.every((name) => {
      const childRel = [...relParts, name].join("/");
      if (virtuallyRemoved.has(childRel)) {
        return true;
      }
      const childAbs = path.join(dirAbs, name);
      try {
        const st = statSync(childAbs);
        if (st.isDirectory()) {
          return directoryIsEmptyForPrune(
            childAbs,
            [...relParts, name],
            virtuallyRemoved,
          );
        }
      } catch {
        return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Lists empty directories under ratified inbox queues (deepest paths first).
 * @param {string} repoRoot
 * @param {Set<string>} [virtuallyRemoved] paths already removed in a dry-run pass
 * @returns {string[]} POSIX paths relative to repo root
 */
export function listEmptyInboxDirectories(repoRoot, virtuallyRemoved = new Set()) {
  /** @type {string[]} */
  const empty = [];

  for (const segs of INBOX_PRUNE_ROOTS) {
    const rootAbs = path.join(repoRoot, ...segs);
    if (!existsSync(rootAbs)) {
      continue;
    }
    const queueDepth = segs.length;
    /**
     * @param {string} dirAbs
     * @param {string[]} relParts
     */
    const walkQueue = (dirAbs, relParts) => {
      for (const e of readdirSync(dirAbs, { withFileTypes: true })) {
        if (e.name.startsWith(".")) {
          continue;
        }
        const childRel = [...relParts, e.name].join("/");
        if (e.isDirectory()) {
          if (virtuallyRemoved.has(childRel)) {
            continue;
          }
          walkQueue(path.join(dirAbs, e.name), [...relParts, e.name]);
        }
      }
      const rel = relParts.join("/");
      if (virtuallyRemoved.has(rel) || relParts.length <= queueDepth) {
        return;
      }
      if (directoryIsEmptyForPrune(dirAbs, relParts, virtuallyRemoved)) {
        empty.push(rel);
      }
    };
    walkQueue(rootAbs, [...segs]);
  }

  return empty.sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
}

/**
 * Removes orphan empty directories under ratified inbox queues.
 * @param {string} repoRoot
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ removed: string[], dryRun: boolean }}
 */
export function pruneEmptyInboxDirectories(repoRoot, opts = {}) {
  const dryRun = opts.dryRun ?? false;
  /** @type {string[]} */
  const removed = [];
  const virtuallyRemoved = new Set();
  for (;;) {
    const candidates = listEmptyInboxDirectories(repoRoot, virtuallyRemoved);
    if (candidates.length === 0) {
      break;
    }
    let passCount = 0;
    for (const rel of candidates) {
      if (virtuallyRemoved.has(rel)) {
        continue;
      }
      const abs = path.join(repoRoot, rel);
      if (!dryRun && (!existsSync(abs) || !directoryIsEffectivelyEmpty(abs))) {
        continue;
      }
      if (!dryRun) {
        try {
          rmdirSync(abs);
        } catch {
          continue;
        }
      } else {
        virtuallyRemoved.add(rel);
      }
      removed.push(rel);
      passCount++;
    }
    if (passCount === 0) {
      break;
    }
  }
  return { removed, dryRun };
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
      if (!existsSync(dirAbs) || !directoryIsEffectivelyEmpty(dirAbs)) {
        continue;
      }
      rmdirSync(dirAbs);
    } catch {
      /* ignore */
    }
  }
  const pruned = pruneEmptyInboxDirectories(repoRoot);
  if (pruned.removed.length > 0) {
    console.log(
      `[migrate-inbox-convention] pruned ${pruned.removed.length} empty inbox director${pruned.removed.length === 1 ? "y" : "ies"}`,
    );
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
  let pruneOnly = false;
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
    } else if (a === "--prune-empty-dirs") {
      pruneOnly = true;
    } else if (a === "--manifest" && argv[i + 1]) {
      manifestPath = argv[++i];
    } else if (a === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun, write, manifestPath, root, pruneOnly };
}

function main() {
  const args = parseArgs(process.argv);

  if (args.pruneOnly) {
    const result = pruneEmptyInboxDirectories(args.root, { dryRun: !args.write });
    const mode = result.dryRun ? "dry-run" : "write";
    console.log(
      `[migrate-inbox-convention] prune-empty-dirs (${mode}): ${result.removed.length} director${result.removed.length === 1 ? "y" : "ies"}`,
    );
    for (const rel of result.removed) {
      console.log(`  ${rel}`);
    }
    return;
  }
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
  const outPath = args.manifestPath ?? defaultManifestPath(args.root);
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
  applyReferenceUpdatesFromManifest(
    /** @type {Array<{ file: string, before: string, after: string }>} */ (
      persisted.referenceUpdates ?? []
    ),
    args.root,
  );
  applyInboxRenamesFromManifest(renames, args.root);
  writeInboxArtifactIndex(args.root, renames);
  console.log(
    `[migrate-inbox-convention] write applied from ${mp} (TESSERACT_MIGRATION_GO=1)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
