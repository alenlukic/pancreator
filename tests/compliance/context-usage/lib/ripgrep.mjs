import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RIPGREP_BIN = process.platform === "win32" ? "rg.exe" : "rg";
const PLATFORM_PACKAGE = `@cursor/sdk-${process.platform}-${process.arch}`;

function isExistingFile(filePath) {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function rgFromPlatformPackageRoot(packageRoot) {
  return path.join(packageRoot, "bin", RIPGREP_BIN);
}

function walkAncestorsForPlatformRipgrep(startDir) {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (current !== root) {
    const fromNodeModules = path.join(current, "node_modules", PLATFORM_PACKAGE, "bin", RIPGREP_BIN);
    if (isExistingFile(fromNodeModules)) {
      return fromNodeModules;
    }
    const fromPnpmHoist = path.join(
      current,
      "node_modules",
      ".pnpm",
      "node_modules",
      PLATFORM_PACKAGE,
      "bin",
      RIPGREP_BIN,
    );
    if (isExistingFile(fromPnpmHoist)) {
      return fromPnpmHoist;
    }
    current = path.dirname(current);
  }
  return undefined;
}

/**
 * @param {string} [repoRoot]
 */
export function resolveCursorRipgrepBinaryPath(repoRoot) {
  const configured = process.env.CURSOR_RIPGREP_PATH;
  if (configured && path.isAbsolute(configured) && isExistingFile(configured)) {
    return configured;
  }

  const require = createRequire(import.meta.url);
  try {
    const packageJson = require.resolve(`${PLATFORM_PACKAGE}/package.json`);
    const bundled = rgFromPlatformPackageRoot(path.dirname(packageJson));
    if (isExistingFile(bundled)) {
      return bundled;
    }
  } catch {
    // optional platform package may be absent
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromHarness = walkAncestorsForPlatformRipgrep(path.resolve(moduleDir, "..", "..", ".."));
  if (fromHarness) {
    return fromHarness;
  }

  if (repoRoot) {
    const fromRepo = walkAncestorsForPlatformRipgrep(repoRoot);
    if (fromRepo) {
      return fromRepo;
    }
  }

  return walkAncestorsForPlatformRipgrep(process.cwd());
}

/**
 * @param {string} [repoRoot]
 */
export function ensureCursorSdkRipgrepConfigured(repoRoot) {
  const resolved = resolveCursorRipgrepBinaryPath(repoRoot);
  if (!resolved) {
    return false;
  }
  process.env.CURSOR_RIPGREP_PATH = resolved;
  return true;
}
