#!/usr/bin/env node
/**
 * @file Phase 0a scaffold check: `package.json` dependency boundaries
 * and required files. Source imports are covered by
 * @tesseract/no-horizontal-primitive-deps in ESLint.
 *
 * Carveout: `@tesseract/cli` and `@tesseract/mcp-server` are workspace
 * composers (`tess` / MCP); they MAY list any workspace `@tesseract/*`
 * dependency (BOOTSTRAP.md Phase 3 steps 8 and 9).
 */
const WORKSPACE_COMPOSER_PRIMITIVE_IDS = new Set(["cli", "mcp-server"]);
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TESSERACT_PREFIX = "@tesseract/";

const PRIMITIVE_DIRS = readdirSync(
  path.join(REPO_ROOT, "internal", "packages", "@tesseract"),
  { withFileTypes: true },
)
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const META_ROOT = "internal/packages/tesseract";

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
  if (!depKey.startsWith(TESSERACT_PREFIX)) {
    return null;
  }
  const rest = depKey.slice(TESSERACT_PREFIX.length);
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
          `Meta package in ${String(file)} lists unknown @tesseract package "${name}" in ${fieldName}.`,
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
      `Primitive @tesseract/${ownerName} in ${String(file)} MUST NOT list @tesseract/${name} in ${fieldName}; only @tesseract/core and the current package are allowed (horizontal-dependency policy).`,
    );
  }
}

const workspacePath = path.join(REPO_ROOT, "pnpm-workspace.yaml");
if (!existsSync(workspacePath)) {
  err("pnpm-workspace.yaml is missing.");
} else {
  const ws = readFileSync(workspacePath, "utf8");
  const tesseractScopeCovered = ws.includes("internal/packages/@tesseract/*");
  if (!tesseractScopeCovered) {
    for (const name of PRIMITIVE_DIRS) {
      if (!ws.includes(name)) {
        err(
          `Workspace file must include a glob for scoped primitives (e.g. internal/packages/@tesseract/*) or list @tesseract/${name} explicitly.`,
        );
        break;
      }
    }
  }
  const metaCovered = ws.includes("internal/packages/*");
  if (!metaCovered && !ws.includes("internal/packages/tesseract")) {
    err(
      "Workspace file must include `internal/packages/*` (so internal/packages/tesseract is a member) or add `internal/packages/tesseract` explicitly.",
    );
  }
  if (!existsSync(path.join(REPO_ROOT, "internal", "packages", "tesseract"))) {
    err("Meta package path internal/packages/tesseract is missing on disk.");
  }
}

for (const name of PRIMITIVE_DIRS) {
  const pkgPath = path.join(
    REPO_ROOT,
    "internal",
    "packages",
    "@tesseract",
    name,
    "package.json",
  );
  if (!existsSync(pkgPath)) {
    err(`Missing package.json for @tesseract/${name}.`);
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
      checkDepSection(/** @type {Record<string, string>} */ (sec), metaPath, f, "tesseract", "meta");
    }
  }
} else {
  err(`Missing ${META_ROOT}/package.json.`);
}

for (const d of PRIMITIVE_DIRS) {
  const src = path.join(
    REPO_ROOT,
    "internal",
    "packages",
    "@tesseract",
    d,
    "src",
    "index.ts",
  );
  if (!existsSync(src)) {
    err(`Missing ${src}.`);
  }
}
const tesseractSrc = path.join(
  REPO_ROOT,
  "internal",
  "packages",
  "tesseract",
  "src",
  "index.ts",
);
if (!existsSync(tesseractSrc)) {
  err("Missing internal/packages/tesseract/src/index.ts.");
}

if (process.argv.includes("--list-packages")) {
  const all = new Set(
    PRIMITIVE_DIRS.map((d) => `@tesseract/${d}`).concat("tesseract"),
  );
  for (const id of Array.from(all).sort()) {
    console.log(id);
  }
}

process.exit(failed > 0 ? 1 : 0);
