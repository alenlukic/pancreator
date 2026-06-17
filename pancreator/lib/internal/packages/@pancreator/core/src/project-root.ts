import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT_RE = /^project_root:\s*["']?([^"'\s#]+)["']?/m;

/** Parses `project_root` from pancreator.yaml text; defaults to `"."`. */
export function readProjectRootFromYaml(raw: string): string {
  const match = PROJECT_ROOT_RE.exec(raw);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : ".";
}

const EMBEDDED_PROJECT_DIR = ".pancreator";
const SELF_HOST_PROJECT_DIR = "pancreator";

/** Resolves live `pancreator.yaml` under an embedded harness or greenfield harness root. */
export function resolvePancreatorYamlPath(harnessRoot: string): string | undefined {
  const harness = path.resolve(harnessRoot);
  const candidates = [
    path.join(harness, EMBEDDED_PROJECT_DIR, "pancreator.yaml"),
    path.join(harness, SELF_HOST_PROJECT_DIR, "pancreator.yaml"),
    path.join(harness, "pancreator.yaml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Resolves live `pancreator-model-escalation.yaml` for embedded or greenfield harness roots. */
export function resolveModelEscalationYamlPath(harnessRoot: string): string | undefined {
  const harness = path.resolve(harnessRoot);
  const candidates = [
    path.join(harness, EMBEDDED_PROJECT_DIR, "pancreator-model-escalation.yaml"),
    path.join(harness, SELF_HOST_PROJECT_DIR, "pancreator-model-escalation.yaml"),
    path.join(harness, "pancreator-model-escalation.yaml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Reads `project_root` from the resolved live config; defaults to `"."` when absent. */
export function readProjectRoot(harnessRoot: string): string {
  const cfgPath = resolvePancreatorYamlPath(harnessRoot);
  if (cfgPath === undefined) {
    return ".";
  }
  const raw = readFileSync(cfgPath, "utf8");
  return readProjectRootFromYaml(raw);
}

/** Absolute path to the configured project root under a harness root. */
export function projectRootAbs(harnessRoot: string, projectRootRel?: string): string {
  const rel = projectRootRel ?? readProjectRoot(harnessRoot);
  const harness = path.resolve(harnessRoot);
  if (rel === "." || rel === "") {
    return harness;
  }
  return path.resolve(harness, rel);
}

/** Joins path segments under the resolved project root. */
export function resolveProjectPath(harnessRoot: string, ...segments: string[]): string {
  return path.join(projectRootAbs(harnessRoot), ...segments);
}

/** Resolves a project-relative posix path stored in ledgers and artifacts. */
export function resolveRepoPath(harnessRoot: string, relPosix: string): string {
  const norm = relPosix.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (norm === "pancreator.yaml") {
    return resolvePancreatorYamlPath(harnessRoot) ?? path.join(path.resolve(harnessRoot), "pancreator.yaml");
  }
  if (norm === "pancreator-model-escalation.yaml") {
    return (
      resolveModelEscalationYamlPath(harnessRoot) ??
      path.join(path.resolve(harnessRoot), "pancreator-model-escalation.yaml")
    );
  }
  if (norm === ".env" || norm.startsWith(".env.")) {
    return path.join(path.resolve(harnessRoot), ...norm.split("/"));
  }
  return resolveProjectPath(harnessRoot, ...norm.split("/"));
}
