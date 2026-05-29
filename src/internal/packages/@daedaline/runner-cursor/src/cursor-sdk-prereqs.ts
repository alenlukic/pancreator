import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RIPGREP_BIN = process.platform === "win32" ? "rg.exe" : "rg";
const PLATFORM_PACKAGE = `@cursor/sdk-${process.platform}-${process.arch}`;

function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function rgFromPlatformPackageRoot(packageRoot: string): string {
  return path.join(packageRoot, "bin", RIPGREP_BIN);
}

function tryResolvePlatformPackageFromModuleDir(moduleDir: string): string | undefined {
  const candidate = rgFromPlatformPackageRoot(
    path.join(moduleDir, "node_modules", PLATFORM_PACKAGE),
  );
  return isExistingFile(candidate) ? candidate : undefined;
}

function walkAncestorsForPlatformRipgrep(startDir: string): string | undefined {
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
 * Resolves the bundled `rg` binary shipped with `@cursor/sdk-<platform>-<arch>`.
 * Returns an absolute path when found; otherwise `undefined`.
 */
export function resolveCursorRipgrepBinaryPath(repoRoot?: string): string | undefined {
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
    // optional platform package may be absent on unsupported hosts
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromRunnerPackage = tryResolvePlatformPackageFromModuleDir(
    path.resolve(moduleDir, "..", "..", "..", ".."),
  );
  if (fromRunnerPackage) {
    return fromRunnerPackage;
  }

  if (repoRoot) {
    const fromRepo = walkAncestorsForPlatformRipgrep(repoRoot);
    if (fromRepo) {
      return fromRepo;
    }
  }

  if (process.argv[1]) {
    const fromArgv = walkAncestorsForPlatformRipgrep(path.dirname(path.resolve(process.argv[1])));
    if (fromArgv) {
      return fromArgv;
    }
  }

  return walkAncestorsForPlatformRipgrep(process.cwd());
}

/**
 * Sets `CURSOR_RIPGREP_PATH` before `@cursor/sdk` local runtime starts so
 * `createLocalExecutor` can call `configureRipgrepPath()` before ignore-map init.
 */
export function ensureCursorSdkRipgrepConfigured(repoRoot?: string): boolean {
  const resolved = resolveCursorRipgrepBinaryPath(repoRoot);
  if (!resolved) {
    return false;
  }
  process.env.CURSOR_RIPGREP_PATH = resolved;
  return true;
}
