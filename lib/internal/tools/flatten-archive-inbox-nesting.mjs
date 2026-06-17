#!/usr/bin/env node
/**
 * Flatten legacy per-task nested archives under `.pan/archive/inbox/in/<day>/<task-id>/`
 * into canonical day-bucket leaves `.pan/archive/inbox/in/<day>/<basename>`, update
 * references, and prune empty inbox queue directories.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyReferenceUpdatesFromManifest,
  inventoryReferences,
} from "./migrate-timestamp-naming.mjs";
import { pruneEmptyInboxDirectories } from "./migrate-inbox-convention.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY_DIR_RE = /^\d{6}_\d{2}-\d{2}-\d{2}$/u;
const ARCHIVE_PREFIX = ".pan/archive/inbox/in";

/**
 * @param {string} repoRoot
 * @returns {Array<{ sourceRel: string, targetRel: string }>}
 */
export function planArchiveInboxFlatten(repoRoot) {
  const archiveRoot = path.join(repoRoot, ...ARCHIVE_PREFIX.split("/"));
  if (!existsSync(archiveRoot)) {
    return [];
  }
  /** @type {Array<{ sourceRel: string, targetRel: string }>} */
  const moves = [];
  for (const dayName of readdirSync(archiveRoot)) {
    if (!DAY_DIR_RE.test(dayName) || dayName.startsWith(".")) {
      continue;
    }
    const dayAbs = path.join(archiveRoot, dayName);
    if (!statSync(dayAbs).isDirectory()) {
      continue;
    }
    for (const entry of readdirSync(dayAbs)) {
      if (entry.startsWith(".")) {
        continue;
      }
      const entryAbs = path.join(dayAbs, entry);
      if (!statSync(entryAbs).isDirectory()) {
        continue;
      }
      for (const fileName of readdirSync(entryAbs)) {
        if (fileName.startsWith(".") || !statSync(path.join(entryAbs, fileName)).isFile()) {
          continue;
        }
        const sourceRel = path.posix.join(ARCHIVE_PREFIX, dayName, entry, fileName);
        const targetRel = path.posix.join(ARCHIVE_PREFIX, dayName, fileName);
        moves.push({ sourceRel, targetRel });
      }
    }
  }
  return moves.sort((a, b) => a.sourceRel.localeCompare(b.sourceRel));
}

/**
 * @param {string} repoRoot
 * @param {{ dryRun?: boolean }} [opts]
 */
export function applyArchiveInboxFlatten(repoRoot, opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const moves = planArchiveInboxFlatten(repoRoot);
  /** @type {Array<{ file: string, line: number, column: number, jsonPointer: string | null, before: string, after: string }>} */
  const referenceUpdates = [];

  for (const move of moves) {
    const targetAbs = path.join(repoRoot, move.targetRel);
    if (existsSync(targetAbs)) {
      throw new Error(`Flatten target already exists: ${move.targetRel} (from ${move.sourceRel})`);
    }
    for (const hit of inventoryReferences(move.sourceRel, repoRoot)) {
      referenceUpdates.push({
        file: hit.file,
        line: hit.line,
        column: hit.column,
        jsonPointer: null,
        before: hit.before,
        after: hit.before.replaceAll(move.sourceRel, move.targetRel),
      });
    }
  }

  if (!dryRun) {
    for (const move of moves) {
      const sourceAbs = path.join(repoRoot, move.sourceRel);
      const targetAbs = path.join(repoRoot, move.targetRel);
      mkdirSync(path.dirname(targetAbs), { recursive: true });
      renameSync(sourceAbs, targetAbs);
    }
    applyReferenceUpdatesFromManifest(referenceUpdates, repoRoot);
    pruneEmptyInboxDirectories(repoRoot);
  }

  return { moves, referenceUpdates, dryRun };
}

function parseArgs(argv) {
  let dryRun = true;
  let write = false;
  let root = path.resolve(__dirname, "..", "..", "..");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      write = false;
    } else if (a === "--write") {
      write = true;
      dryRun = false;
    } else if (a === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun: write ? false : dryRun, root };
}

function main() {
  const args = parseArgs(process.argv);
  const result = applyArchiveInboxFlatten(args.root, { dryRun: args.dryRun });
  const mode = args.dryRun ? "dry-run" : "write";
  console.log(
    `[flatten-archive-inbox-nesting] ${mode}: ${result.moves.length} file move(s), ${result.referenceUpdates.length} reference update(s)`,
  );
  for (const move of result.moves) {
    console.log(`  ${move.sourceRel} -> ${move.targetRel}`);
  }
  if (!args.dryRun) {
    const pruned = pruneEmptyInboxDirectories(args.root);
    console.log(
      `[flatten-archive-inbox-nesting] pruned ${pruned.removed.length} empty inbox director${pruned.removed.length === 1 ? "y" : "ies"}`,
    );
    for (const rel of pruned.removed) {
      console.log(`  ${rel}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
