#!/usr/bin/env node
/**
 * One-shot repository layout migration: archive/, work/, lib/ roots.
 * @see lib/memory/features/repository-layout-restructure-and-archive-migration/spec.md
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".turbo",
  "coverage",
]);

/** Paths excluded from reference rewrites (operator sandbox + migration mapping docs). */
const REFERENCE_EXCLUDE_PATHS = new Set([
  "lib/internal/tools/migrate-repository-layout.mjs",
  "lib/internal/tools/migrate-repository-layout.test.mjs",
]);

/** Path prefixes excluded from reference rewrites (operator sandbox). */
const REFERENCE_EXCLUDE_PREFIXES = ["lib/inbox/notes/"];

/** Ordered longest-first reference replacements after tree moves. */
export const REFERENCE_REPLACEMENTS = [
  ["src/inbox/archive/", "archive/inbox/"],
  ["src/internal/work_archive/", "archive/work/"],
  ["src/work/", "work/"],
  ["src/skills/", "lib/personas/skills/"],
  ["src/inbox/in/", "lib/inbox/in/"],
  ["src/inbox/out/", "lib/inbox/out/"],
  ["src/inbox/threads/", "lib/inbox/threads/"],
  ["src/inbox/notes/", "lib/inbox/notes/"],
  ["src/internal/", "lib/internal/"],
  ["src/memory/", "lib/memory/"],
  ["src/personas/", "lib/personas/"],
  ["src/pipelines/", "lib/pipelines/"],
  ["src/ensembles/", "lib/ensembles/"],
  ["/src/inbox/archive/", "/archive/inbox/"],
  ["/src/internal/work_archive/", "/archive/work/"],
  ["/src/work/", "/work/"],
  ["/src/skills/", "/lib/personas/skills/"],
  ["/src/inbox/in/", "/lib/inbox/in/"],
  ["/src/inbox/out/", "/lib/inbox/out/"],
  ["/src/inbox/threads/", "/lib/inbox/threads/"],
  ["/src/inbox/notes/", "/lib/inbox/notes/"],
  ["/src/internal/", "/lib/internal/"],
  ["/src/memory/", "/lib/memory/"],
  ["/src/personas/", "/lib/personas/"],
  ["/src/pipelines/", "/lib/pipelines/"],
  ["/src/ensembles/", "/lib/ensembles/"],
];

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdc",
  ".mjs",
  ".js",
  ".ts",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".sh",
  ".txt",
  ".css",
  ".html",
  ".svg",
]);

/**
 * @param {string} rel
 * @returns {boolean}
 */
export function isExcludedFromReferenceRewrite(rel) {
  const posix = rel.replace(/\\/g, "/");
  if (REFERENCE_EXCLUDE_PATHS.has(posix)) return true;
  return REFERENCE_EXCLUDE_PREFIXES.some((p) => posix === p.slice(0, -1) || posix.startsWith(p));
}

/**
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function applyReferenceReplacements(text) {
  let out = text;
  let count = 0;
  for (const [from, to] of REFERENCE_REPLACEMENTS) {
    if (!out.includes(from)) continue;
    const parts = out.split(from);
    count += parts.length - 1;
    out = parts.join(to);
  }
  return { text: out, count };
}

/**
 * @param {string} repoRoot
 * @returns {{ from: string, to: string }[]}
 */
export function planTreeMoves(repoRoot = REPO_ROOT) {
  /** @type {{ from: string, to: string }[]} */
  const moves = [];

  const pushDirContents = (fromRel, toRel) => {
    const fromAbs = path.join(repoRoot, fromRel);
    if (!existsSync(fromAbs)) return;
    for (const entry of readdirSync(fromAbs)) {
      if (entry === ".gitkeep") continue;
      moves.push({
        from: path.posix.join(fromRel.replace(/\\/g, "/"), entry),
        to: path.posix.join(toRel.replace(/\\/g, "/"), entry),
      });
    }
  };

  pushDirContents("lib/inbox/archive", "archive/inbox");
  pushDirContents("lib/internal/work_archive", "archive/work");
  pushDirContents("lib/work", "work");

  if (existsSync(path.join(repoRoot, "src"))) {
    moves.push({ from: "src", to: "lib" });
  }

  if (existsSync(path.join(repoRoot, "lib", "skills"))) {
    for (const entry of readdirSync(path.join(repoRoot, "lib", "skills"))) {
      moves.push({
        from: path.posix.join("lib/skills", entry),
        to: path.posix.join("lib/personas/skills", entry),
      });
    }
  } else if (existsSync(path.join(repoRoot, "src", "skills"))) {
    // pre-rename planning
    for (const entry of readdirSync(path.join(repoRoot, "src", "skills"))) {
      moves.push({
        from: path.posix.join("lib/skills", entry),
        to: path.posix.join("lib/personas/skills", entry),
      });
    }
  }

  return moves;
}

/**
 * @param {string} repoRoot
 * @param {(rel: string) => boolean} [predicate]
 * @returns {string[]}
 */
export function collectTextFiles(repoRoot = REPO_ROOT, predicate = () => true) {
  /** @type {string[]} */
  const files = [];

  /** @param {string} absDir */
  const walk = (absDir) => {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) && predicate(rel)) {
          files.push(rel);
        }
      }
    }
  };

  walk(repoRoot);
  return files.sort();
}

/**
 * @param {string} repoRoot
 * @returns {{ rel: string, replacements: number }[]}
 */
export function planReferenceUpdates(repoRoot = REPO_ROOT) {
  const files = collectTextFiles(repoRoot, (rel) => !isExcludedFromReferenceRewrite(rel));
  /** @type {{ rel: string, replacements: number }[]} */
  const plan = [];
  for (const rel of files) {
    const raw = readFileSync(path.join(repoRoot, rel), "utf8");
    const { count } = applyReferenceReplacements(raw);
    if (count > 0) {
      plan.push({ rel, replacements: count });
    }
  }
  return plan;
}

/**
 * @param {string} repoRoot
 * @param {boolean} dryRun
 */
function ensureParentDir(repoRoot, rel, dryRun) {
  const abs = path.join(repoRoot, rel);
  const parent = path.dirname(abs);
  if (!existsSync(parent)) {
    if (dryRun) {
      console.log(`[mkdir] ${path.relative(repoRoot, parent)}`);
    } else {
      mkdirSync(parent, { recursive: true });
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {string} fromRel
 * @param {string} toRel
 * @param {boolean} dryRun
 */
function gitMove(repoRoot, fromRel, toRel, dryRun) {
  const fromAbs = path.join(repoRoot, fromRel);
  if (!existsSync(fromAbs)) return;
  ensureParentDir(repoRoot, toRel, dryRun);
  const cmd = `git mv ${JSON.stringify(fromRel)} ${JSON.stringify(toRel)}`;
  if (dryRun) {
    console.log(`[git mv] ${fromRel} -> ${toRel}`);
    return;
  }
  try {
    execSync(cmd, { cwd: repoRoot, stdio: "pipe" });
  } catch {
    renameSync(fromAbs, path.join(repoRoot, toRel));
    execSync(`git add ${JSON.stringify(toRel)}`, { cwd: repoRoot, stdio: "pipe" });
  }
}

/**
 * @param {string} repoRoot
 * @param {boolean} dryRun
 */
export function executeTreeMoves(repoRoot = REPO_ROOT, dryRun = false) {
  // Phase 1: move archive and work subtrees out of lib/
  for (const [from, to] of [
    ["lib/inbox/archive", "archive/inbox"],
    ["lib/internal/work_archive", "archive/work"],
    ["lib/work", "work"],
  ]) {
    if (existsSync(path.join(repoRoot, from))) {
      gitMove(repoRoot, from, to, dryRun);
    }
  }

  // Phase 2: rename src -> lib
  if (existsSync(path.join(repoRoot, "src"))) {
    gitMove(repoRoot, "src", "lib", dryRun);
  }

  // Phase 3: relocate skills under lib/personas/skills
  const skillsRoot = path.join(repoRoot, "lib", "skills");
  if (existsSync(skillsRoot)) {
    ensureParentDir(repoRoot, "lib/personas/skills/.gitkeep", dryRun);
    for (const entry of readdirSync(skillsRoot)) {
      gitMove(
        repoRoot,
        path.posix.join("lib/skills", entry),
        path.posix.join("lib/personas/skills", entry),
        dryRun,
      );
    }
    if (!dryRun && existsSync(skillsRoot) && readdirSync(skillsRoot).length === 0) {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {boolean} dryRun
 * @returns {number}
 */
export function executeReferenceUpdates(repoRoot = REPO_ROOT, dryRun = false) {
  const files = collectTextFiles(repoRoot, (rel) => !isExcludedFromReferenceRewrite(rel));
  let total = 0;
  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    const raw = readFileSync(abs, "utf8");
    const { text, count } = applyReferenceReplacements(raw);
    if (count > 0) {
      total += count;
      if (dryRun) {
        console.log(`[rewrite] ${rel} (${count} replacements)`);
      } else {
        writeFileSync(abs, text, "utf8");
      }
    }
  }
  return total;
}

/**
 * Merge -standard model policy into canonical agent files; delete tier variants.
 * @param {string} repoRoot
 * @param {boolean} dryRun
 */
export function retireAgentVariants(repoRoot = REPO_ROOT, dryRun = false) {
  const agentsDir = path.join(repoRoot, ".cursor", "agents");
  if (!existsSync(agentsDir)) return;

  const names = readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

  const bases = names.filter(
    (n) => !n.endsWith("-standard") && !n.endsWith("-complex") && n !== "general-purpose",
  );

  for (const base of bases) {
    const standardPath = path.join(agentsDir, `${base}-standard.md`);
    const canonicalPath = path.join(agentsDir, `${base}.md`);
    if (!existsSync(standardPath) || !existsSync(canonicalPath)) continue;

    const standardText = readFileSync(standardPath, "utf8");
    const modelMatch = standardText.match(/^model:\s*(.+)$/m);
    const model = modelMatch ? modelMatch[1].trim() : "auto";

    let canonical = readFileSync(canonicalPath, "utf8");
    canonical = canonical.replace(/^model:\s*.+$/m, `model: ${model}`);
    canonical = canonical.replace(/^name:\s*.+$/m, `name: ${base}`);
    canonical = canonical.replace(
      /pancreator-model-tier:\s*.+$/m,
      "pancreator-model-tier: canonical",
    );
    canonical = canonical.replace(
      /^description:\s*.+$/m,
      `description: "Canonical \`${base}\` subagent projection for persona-owned pipeline stages."`,
    );
    const { text: rewritten } = applyReferenceReplacements(canonical);
    canonical = rewritten;
    canonical = canonical.replace(/\n## Tier guidance[\s\S]*?(?=\n## |\n*$)/u, "\n");
    canonical = canonical.replace(
      /This file is a compact Cursor projection for the canonical persona at\n`[^`]+`\./u,
      `This file is the canonical Cursor projection for \`${base}\` at \`lib/personas/${base}.md\`.`,
    );

    if (dryRun) {
      console.log(`[agent] merge ${base}-standard.md -> ${base}.md (model: ${model})`);
    } else {
      writeFileSync(canonicalPath, canonical, "utf8");
    }

    for (const suffix of ["-standard", "-complex"]) {
      const variant = path.join(agentsDir, `${base}${suffix}.md`);
      if (!existsSync(variant)) continue;
      if (dryRun) {
        console.log(`[delete] .cursor/agents/${base}${suffix}.md`);
      } else {
        rmSync(variant);
      }
    }
  }

  const tiersHandbook = path.join(repoRoot, "lib", "memory", "handbook", "subagent-model-tiers.md");
  const tiersHandbookLegacy = path.join(repoRoot, "src", "memory", "handbook", "subagent-model-tiers.md");
  for (const p of [tiersHandbook, tiersHandbookLegacy]) {
    if (!existsSync(p)) continue;
    if (dryRun) {
      console.log(`[delete] ${path.relative(repoRoot, p)}`);
    } else {
      rmSync(p);
    }
  }
}

/**
 * @param {boolean} dryRun
 */
export function runMigration(dryRun = false) {
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY ===");
  console.log("\n--- Tree moves ---");
  executeTreeMoves(REPO_ROOT, dryRun);
  console.log("\n--- Reference rewrites ---");
  const count = executeReferenceUpdates(REPO_ROOT, dryRun);
  console.log(`Total reference replacements: ${count}`);
  console.log("\n--- Agent variant retirement ---");
  retireAgentVariants(REPO_ROOT, dryRun);
  console.log(dryRun ? "\nDry run complete." : "\nApply complete.");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (!dryRun && !apply) {
    console.error("Usage: node migrate-repository-layout.mjs --dry-run|--apply");
    process.exit(1);
  }
  runMigration(dryRun);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate-repository-layout.mjs")) {
  main();
}
