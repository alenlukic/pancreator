#!/usr/bin/env node
/**
 * Backfill `archived_inbox_source` (and related inbox lineage fields) on indexed
 * feature `index.json` records from closed work archives and on-disk inbox archives.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stringifyRepoJson } from "./canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY_DIR_RE = /^\d{6}_\d{2}-\d{2}-\d{2}$/u;
const INBOX_IN_PREFIX = "lib/inbox/in/";
const ARCHIVE_IN_PREFIX = ".pan/archive/inbox/in/";
const TASK_PREFIX_RE = /^(\d+_\d+)/u;

/**
 * @param {string} sourceRel
 * @param {string | undefined} fallbackDayDir
 * @returns {string | null}
 */
function archiveInboxPathForSource(sourceRel, fallbackDayDir) {
  const norm = sourceRel.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!norm.startsWith(INBOX_IN_PREFIX)) {
    return null;
  }
  const tail = norm.slice(INBOX_IN_PREFIX.length);
  const basename = path.posix.basename(tail);
  const parts = tail.split("/");
  let inboxDayDir = parts[0] && DAY_DIR_RE.test(parts[0]) ? parts[0] : fallbackDayDir;
  if (inboxDayDir === undefined || !DAY_DIR_RE.test(inboxDayDir)) {
    return null;
  }
  return path.posix.join(ARCHIVE_IN_PREFIX, inboxDayDir, basename);
}

/**
 * @param {string} featureId
 * @returns {string[]}
 */
function featureIdAliases(featureId) {
  /** @type {string[]} */
  const out = [featureId];
  if (featureId.startsWith("command-center-")) {
    out.push(`cockpit-v2-${featureId.slice("command-center-".length)}`);
  }
  if (featureId.startsWith("cockpit-v2-")) {
    out.push(`command-center-${featureId.slice("cockpit-v2-".length)}`);
  }
  return out;
}

/**
 * @param {string} slug
 * @returns {string}
 */
function slugVariants(slug) {
  const hyphen = slug.replace(/_/gu, "-");
  const underscore = slug.replace(/-/gu, "_");
  return `${hyphen}\n${underscore}`;
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function listArchivedInboxFiles(repoRoot) {
  const archiveRoot = path.join(repoRoot, ...ARCHIVE_IN_PREFIX.split("/").filter(Boolean));
  if (!existsSync(archiveRoot)) {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  for (const day of readdirSync(archiveRoot)) {
    if (!DAY_DIR_RE.test(day)) {
      continue;
    }
    const dayAbs = path.join(archiveRoot, day);
    if (!statSync(dayAbs).isDirectory()) {
      continue;
    }
    for (const fileName of readdirSync(dayAbs)) {
      if (fileName.startsWith(".") || !fileName.endsWith(".md")) {
        continue;
      }
      const fileAbs = path.join(dayAbs, fileName);
      if (!statSync(fileAbs).isFile()) {
        continue;
      }
      out.push(path.posix.join(ARCHIVE_IN_PREFIX, day, fileName));
    }
  }
  return out;
}

/**
 * @param {string} repoRoot
 * @returns {{
 *   byTaskId: Map<string, { state: Record<string, unknown>; day: string }>;
 *   byTaskPrefix: Map<string, { state: Record<string, unknown>; day: string }>;
 *   byFeatureId: Map<string, { state: Record<string, unknown>; day: string }>;
 * }}
 */
function loadClosedWorkStates(repoRoot) {
  /** @type {Map<string, { state: Record<string, unknown>; day: string }>} */
  const byTaskId = new Map();
  /** @type {Map<string, { state: Record<string, unknown>; day: string }>} */
  const byTaskPrefix = new Map();
  /** @type {Map<string, { state: Record<string, unknown>; day: string }>} */
  const byFeatureId = new Map();

  const workRoot = path.join(repoRoot, ".pan/archive/work");
  if (!existsSync(workRoot)) {
    return { byTaskId, byTaskPrefix, byFeatureId };
  }

  for (const day of readdirSync(workRoot)) {
    if (!DAY_DIR_RE.test(day)) {
      continue;
    }
    const dayAbs = path.join(workRoot, day);
    if (!statSync(dayAbs).isDirectory()) {
      continue;
    }
    for (const taskDir of readdirSync(dayAbs)) {
      const stateAbs = path.join(dayAbs, taskDir, "state.json");
      if (!existsSync(stateAbs)) {
        continue;
      }
      const state = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(stateAbs, "utf8")));
      if (state["status"] !== "closed") {
        continue;
      }
      const entry = { state, day };
      const taskId = typeof state["taskId"] === "string" ? state["taskId"] : taskDir;
      byTaskId.set(taskId, entry);
      const prefix = taskId.match(TASK_PREFIX_RE)?.[1];
      if (prefix !== undefined) {
        byTaskPrefix.set(prefix, entry);
      }
      const featureId = typeof state["featureId"] === "string" ? state["featureId"] : undefined;
      if (featureId !== undefined) {
        byFeatureId.set(featureId, entry);
      }
    }
  }

  return { byTaskId, byTaskPrefix, byFeatureId };
}

/**
 * @param {string} repoRoot
 * @param {string} basename
 * @returns {string | null}
 */
function findArchiveByBasename(repoRoot, basename) {
  const archiveRoot = path.join(repoRoot, ...ARCHIVE_IN_PREFIX.split("/").filter(Boolean));
  if (!existsSync(archiveRoot)) {
    return null;
  }
  for (const day of readdirSync(archiveRoot)) {
    if (!DAY_DIR_RE.test(day)) {
      continue;
    }
    const candidateRel = path.posix.join(ARCHIVE_IN_PREFIX, day, basename);
    if (existsSync(path.join(repoRoot, candidateRel))) {
      return candidateRel;
    }
  }
  return null;
}

/**
 * @param {string[]} archiveFiles
 * @param {string} slug
 * @returns {string | null}
 */
function findUniqueArchiveBySlug(archiveFiles, slug) {
  const variants = slugVariants(slug).split("\n");
  const suffixHits = archiveFiles.filter((rel) => {
    const base = path.posix.basename(rel, ".md");
    return variants.some((variant) => base.endsWith(`_${variant}`) || base === variant);
  });
  if (suffixHits.length === 1) {
    return suffixHits[0];
  }
  const containsHits = archiveFiles.filter((rel) => {
    const base = path.posix.basename(rel);
    return variants.some((variant) => base.includes(variant));
  });
  return containsHits.length === 1 ? containsHits[0] : null;
}

/**
 * @param {Record<string, unknown>} rec
 * @param {{
 *   byTaskId: Map<string, { state: Record<string, unknown>; day: string }>;
 *   byTaskPrefix: Map<string, { state: Record<string, unknown>; day: string }>;
 *   byFeatureId: Map<string, { state: Record<string, unknown>; day: string }>;
 * }} states
 * @param {string[]} archiveFiles
 * @param {string} repoRoot
 * @returns {{ priorInboxRel: string; archivedInboxRel: string } | null}
 */
function resolveArchivedInboxForFeature(rec, states, archiveFiles, repoRoot) {
  const taskId =
    typeof rec["task_id"] === "string"
      ? rec["task_id"]
      : typeof rec["taskId"] === "string"
        ? rec["taskId"]
        : undefined;
  const featureId =
    typeof rec["feature_id"] === "string"
      ? rec["feature_id"]
      : typeof rec["featureId"] === "string"
        ? rec["featureId"]
        : undefined;

  /** @type {{ state: Record<string, unknown>; day: string } | undefined} */
  let hit =
    taskId !== undefined
      ? states.byTaskId.get(taskId) ?? states.byTaskPrefix.get(taskId.match(TASK_PREFIX_RE)?.[1] ?? "")
      : undefined;

  if (hit === undefined && featureId !== undefined) {
    for (const alias of featureIdAliases(featureId)) {
      hit = states.byFeatureId.get(alias);
      if (hit !== undefined) {
        break;
      }
    }
  }

  /** @type {string | null} */
  let priorInboxRel = null;
  /** @type {string | null} */
  let archivedInboxRel = null;

  if (hit !== undefined) {
    const source = hit.state["source"];
    if (source !== null && source !== undefined && typeof source === "object") {
      const inboxPath = (source)["inboxPath"];
      if (typeof inboxPath === "string" && inboxPath.trim() !== "") {
        priorInboxRel = inboxPath.replace(/\\/gu, "/").replace(/^\/+/u, "");
        archivedInboxRel = archiveInboxPathForSource(priorInboxRel, hit.day);
        if (archivedInboxRel !== null && !existsSync(path.join(repoRoot, archivedInboxRel))) {
          archivedInboxRel = findArchiveByBasename(repoRoot, path.posix.basename(archivedInboxRel));
        }
      }
    }
  }

  if ((archivedInboxRel === null || !existsSync(path.join(repoRoot, archivedInboxRel))) && featureId !== undefined) {
    archivedInboxRel = findUniqueArchiveBySlug(archiveFiles, featureId);
  }

  if (archivedInboxRel === null || !existsSync(path.join(repoRoot, archivedInboxRel))) {
    return null;
  }

  if (priorInboxRel === null || !priorInboxRel.startsWith(INBOX_IN_PREFIX)) {
    const existing = rec["source_inbox_item"];
    if (existing !== null && existing !== undefined && typeof existing === "object") {
      const priorPath = existing["prior_path"];
      if (typeof priorPath === "string" && priorPath.startsWith(INBOX_IN_PREFIX)) {
        priorInboxRel = priorPath.replace(/\\/gu, "/").replace(/^\/+/u, "");
      }
    }
  }

  if (priorInboxRel === null || !priorInboxRel.startsWith(INBOX_IN_PREFIX)) {
    priorInboxRel = archivedInboxRel.replace(
      /^\.pan\/archive\/inbox\/in\//u,
      INBOX_IN_PREFIX,
    );
  }

  return { priorInboxRel, archivedInboxRel };
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} archivedInboxRel
 * @param {string} priorInboxSourceRel
 */
function patchFeatureIndexRecord(parsed, archivedInboxRel, priorInboxSourceRel) {
  parsed["archived_inbox_source"] = archivedInboxRel;

  const sourceInbox = parsed["source_inbox_item"];
  if (sourceInbox !== undefined && sourceInbox !== null && typeof sourceInbox === "object") {
    sourceInbox["path"] = archivedInboxRel;
    if (typeof sourceInbox["prior_path"] !== "string") {
      sourceInbox["prior_path"] = priorInboxSourceRel;
    }
  } else {
    parsed["source_inbox_item"] = {
      path: archivedInboxRel,
      prior_path: priorInboxSourceRel,
    };
  }

  const intake = parsed["intake"];
  if (intake !== null && intake !== undefined && typeof intake === "object") {
    if (typeof intake["source_inbox_item"] === "string") {
      intake["source_inbox_item"] = archivedInboxRel;
    }
  }

  const delivery = parsed["delivery_report"];
  if (delivery !== null && delivery !== undefined && typeof delivery === "object") {
    delivery["archived_inbox_source"] = archivedInboxRel;
  }

  const artifactIndex = parsed["artifact_index"];
  if (artifactIndex !== null && artifactIndex !== undefined && typeof artifactIndex === "object") {
    const lineage = artifactIndex["lineage"];
    if (lineage !== null && lineage !== undefined && typeof lineage === "object") {
      const src = lineage["source_inbox_item"];
      if (src !== undefined && src !== null && typeof src === "object") {
        src["path"] = archivedInboxRel;
      }
    }
  }
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walkFeatureIndexes(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryAbs = path.join(dir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    const indexAbs = path.join(entryAbs, "index.json");
    if (existsSync(indexAbs)) {
      out.push(indexAbs);
    } else {
      walkFeatureIndexes(entryAbs, out);
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {{ dryRun?: boolean }} [opts]
 */
export function backfillArchivedInboxSource(repoRoot, opts = {}) {
  const dryRun = opts.dryRun ?? true;
  const states = loadClosedWorkStates(repoRoot);
  const archiveFiles = listArchivedInboxFiles(repoRoot);
  /** @type {string[]} */
  const indexPaths = [];
  walkFeatureIndexes(path.join(repoRoot, "lib/memory/features"), indexPaths);

  /** @type {Array<{ featureId: string; indexRel: string; archivedInboxRel: string; priorInboxRel: string }>} */
  const planned = [];
  /** @type {Array<{ featureId: string; reason: string }>} */
  const skipped = [];

  for (const indexAbs of indexPaths) {
    const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(indexAbs, "utf8")));
    if (parsed["status"] !== "indexed") {
      continue;
    }

    const featureId =
      typeof parsed["feature_id"] === "string"
        ? parsed["feature_id"]
        : typeof parsed["featureId"] === "string"
          ? parsed["featureId"]
          : path.basename(path.dirname(indexAbs));

    const existing = typeof parsed["archived_inbox_source"] === "string" ? parsed["archived_inbox_source"] : "";
    if (existing !== "" && existsSync(path.join(repoRoot, existing))) {
      skipped.push({ featureId, reason: "already set" });
      continue;
    }

    const resolved = resolveArchivedInboxForFeature(parsed, states, archiveFiles, repoRoot);
    if (resolved === null) {
      skipped.push({ featureId, reason: "no archived inbox match" });
      continue;
    }

    const indexRel = path.relative(repoRoot, indexAbs).split(path.sep).join("/");
    planned.push({
      featureId,
      indexRel,
      archivedInboxRel: resolved.archivedInboxRel,
      priorInboxRel: resolved.priorInboxRel,
    });

    if (!dryRun) {
      patchFeatureIndexRecord(parsed, resolved.archivedInboxRel, resolved.priorInboxRel);
      writeFileSync(indexAbs, stringifyRepoJson(parsed, repoRoot), "utf8");
    }
  }

  return { planned, skipped, dryRun };
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let dryRun = true;
  let write = false;
  let root = path.resolve(__dirname, "..", "..", "..");
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      write = false;
    } else if (arg === "--write") {
      write = true;
      dryRun = false;
    } else if (arg === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun: write ? false : dryRun, root };
}

function main() {
  const args = parseArgs(process.argv);
  const result = backfillArchivedInboxSource(args.root, { dryRun: args.dryRun });
  const mode = args.dryRun ? "dry-run" : "write";
  console.log(
    `[backfill-archived-inbox-source] ${mode}: ${result.planned.length} patch(es), ${result.skipped.length} skipped`,
  );
  for (const patch of result.planned) {
    console.log(`  ${patch.featureId}`);
    console.log(`    index: ${patch.indexRel}`);
    console.log(`    archived: ${patch.archivedInboxRel}`);
    console.log(`    prior: ${patch.priorInboxRel}`);
  }
  const unmatched = result.skipped.filter((row) => row.reason === "no archived inbox match");
  if (unmatched.length > 0) {
    console.log(`[backfill-archived-inbox-source] unmatched indexed features (${unmatched.length}):`);
    for (const row of unmatched) {
      console.log(`  ${row.featureId}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
