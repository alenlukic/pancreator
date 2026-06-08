#!/usr/bin/env node
/**
 * @file Phase 0a scaffold check: `package.json` dependency boundaries
 * and required files. Source imports are covered by
 * @pancreator/no-horizontal-primitive-deps in ESLint.
 *
 * Carveout: `@pancreator/cli` and `@pancreator/mcp-server` are workspace
 * composers (`pan` / MCP); they MAY list any workspace `@pancreator/*`
 * dependency (.docs/BOOTSTRAP.md Phase 3 steps 8 and 9).
 */
const WORKSPACE_COMPOSER_PRIMITIVE_IDS = new Set(["cli", "mcp-server"]);
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PANCREATOR_PREFIX = "@pancreator/";
const WORK_DAY_DIR_RE = /^\d+_\d{2}-\d{2}-\d{2}$/u;
const ISO_DAY_DIR_RE = /^\d{4}-\d{2}-\d{2}$/u;
const WORK_TASK_ID_RE = /^\d+_\d{4}_[a-z0-9][a-z0-9_-]*$/u;

const PRIMITIVE_DIRS = readdirSync(
  path.join(REPO_ROOT, "lib", "internal", "packages", "@pancreator"),
  { withFileTypes: true },
)
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const META_ROOT = "lib/internal/packages/pancreator";

let failed = 0;
function err(msg) {
  failed += 1;
  console.error(`[check-phase-0a-scaffold] ${msg}`);
}

/**
 * @param {string} depKey
 * @returns {string | null} First path segment of package id after the scope, or `null`
 */
function scopePackageName(depKey) {
  if (!depKey.startsWith(PANCREATOR_PREFIX)) {
    return null;
  }
  const rest = depKey.slice(PANCREATOR_PREFIX.length);
  if (!rest) {
    return null;
  }
  const [id] = rest.split("/");
  return id || null;
}

/**
 * @param {Record<string, string> | undefined} section
 * @param {import('node:fs').PathOrFileDescriptor} file
 * @param {string} fieldName
 * @param {string} ownerName
 * @param {"primitive"|"meta"} kind
 */
function checkDepSection(
  section,
  file,
  fieldName,
  ownerName,
  kind,
) {
  if (section == null) {
    return;
  }
  for (const depKey of Object.keys(section)) {
    const name = scopePackageName(depKey);
    if (name == null) {
      continue;
    }
    if (kind === "meta") {
      if (!PRIMITIVE_DIRS.includes(name)) {
        err(
          `Meta package in ${String(file)} lists unknown @pancreator package "${name}" in ${fieldName}.`,
        );
      }
      continue;
    }
    if (name === "core" || name === ownerName) {
      continue;
    }
    if (WORKSPACE_COMPOSER_PRIMITIVE_IDS.has(ownerName)) {
      continue;
    }
    err(
      `Primitive @pancreator/${ownerName} in ${String(file)} MUST NOT list @pancreator/${name} in ${fieldName}; only @pancreator/core and the current package are allowed (horizontal-dependency policy).`,
    );
  }
}

const workspacePath = path.join(REPO_ROOT, "pnpm-workspace.yaml");
if (!existsSync(workspacePath)) {
  err("pnpm-workspace.yaml is missing.");
} else {
  const ws = readFileSync(workspacePath, "utf8");
  const pancreatorScopeCovered = ws.includes("lib/internal/packages/@pancreator/*");
  if (!pancreatorScopeCovered) {
    for (const name of PRIMITIVE_DIRS) {
      if (!ws.includes(name)) {
        err(
          `Workspace file must include a glob for scoped primitives (e.g. lib/internal/packages/@pancreator/*) or list @pancreator/${name} explicitly.`,
        );
        break;
      }
    }
  }
  const metaCovered = ws.includes("lib/internal/packages/*");
  if (!metaCovered && !ws.includes("lib/internal/packages/pancreator")) {
    err(
      "Workspace file must include `lib/internal/packages/*` (so lib/internal/packages/pancreator is a member) or add `lib/internal/packages/pancreator` explicitly.",
    );
  }
  if (!existsSync(path.join(REPO_ROOT, "lib", "internal", "packages", "pancreator"))) {
    err("Meta package path lib/internal/packages/pancreator is missing on disk.");
  }
}

for (const name of PRIMITIVE_DIRS) {
  const pkgPath = path.join(
    REPO_ROOT,
    "lib",
    "internal",
    "packages",
    "@pancreator",
    name,
    "package.json",
  );
  if (!existsSync(pkgPath)) {
    err(`Missing package.json for @pancreator/${name}.`);
    continue;
  }
  const data = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const f of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const sec = data[f];
    if (sec && typeof sec === "object" && !Array.isArray(sec)) {
      checkDepSection(/** @type {Record<string, string>} */ (sec), pkgPath, f, name, "primitive");
    }
  }
}

const metaPath = path.join(REPO_ROOT, META_ROOT, "package.json");
if (existsSync(metaPath)) {
  const data = JSON.parse(readFileSync(metaPath, "utf8"));
  for (const f of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const sec = data[f];
    if (sec && typeof sec === "object" && !Array.isArray(sec)) {
      checkDepSection(/** @type {Record<string, string>} */ (sec), metaPath, f, "pancreator", "meta");
    }
  }
} else {
  err(`Missing ${META_ROOT}/package.json.`);
}

for (const d of PRIMITIVE_DIRS) {
  const src = path.join(
    REPO_ROOT,
    "lib",
    "internal",
    "packages",
    "@pancreator",
    d,
    "src",
    "index.ts",
  );
  if (!existsSync(src)) {
    err(`Missing ${src}.`);
  }
}
const pancreatorSrc = path.join(
  REPO_ROOT,
  "lib",
  "internal",
  "packages",
  "pancreator",
  "src",
  "index.ts",
);
if (!existsSync(pancreatorSrc)) {
  err("Missing lib/internal/packages/pancreator/src/index.ts.");
}

if (process.argv.includes("--list-packages")) {
  const all = new Set(
    PRIMITIVE_DIRS.map((d) => `@pancreator/${d}`).concat("pancreator"),
  );
  for (const id of Array.from(all).sort()) {
    console.log(id);
  }
}

const workRoot = path.join(REPO_ROOT, ".pan/work");
if (existsSync(workRoot)) {
  for (const dayEntry of readdirSync(workRoot, { withFileTypes: true })) {
    if (!dayEntry.isDirectory()) {
      continue;
    }
    if (ISO_DAY_DIR_RE.test(dayEntry.name)) {
      err(
        `.pan/work/${dayEntry.name} uses ISO date format; day directories MUST match <days-to-fds>_<MM-DD-YY>.`,
      );
    }
    if (!WORK_DAY_DIR_RE.test(dayEntry.name)) {
      continue;
    }
    const dayAbs = path.join(workRoot, dayEntry.name);
    for (const taskEntry of readdirSync(dayAbs, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) {
        continue;
      }
      if (!WORK_TASK_ID_RE.test(taskEntry.name)) {
        err(
          `.pan/work/${dayEntry.name}/${taskEntry.name} MUST match <seconds-to-midnight>_<HHMM>_<slug>.`,
        );
      }
    }
  }
}

process.exit(failed > 0 ? 1 : 0);
