import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type {
  AdoptionCiSignal,
  AdoptionLanguageSignal,
  AdoptionScanReport,
  AdoptionTestFrameworkSignal,
  AdoptionWorkspaceTooling,
} from "./report.js";

function rel(root: string, segment: string): string {
  return path.relative(root, segment).split(path.sep).join("/");
}

function readJsonIfPresent(file: string): Record<string, unknown> | null {
  try {
    const t = readFileSync(file, "utf8");
    const v = JSON.parse(t) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasDepKey(pkg: Record<string, unknown>, name: string): boolean {
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const sec = pkg[key];
    if (sec && typeof sec === "object" && !Array.isArray(sec) && name in (sec as object)) {
      return true;
    }
  }
  return false;
}

function collectLanguages(root: string): AdoptionLanguageSignal[] {
  const out: AdoptionLanguageSignal[] = [];
  const push = (id: string, evidence: string) => {
    const e = rel(root, evidence);
    const cur = out.find((x) => x.id === id);
    if (cur) {
      if (!cur.evidence.includes(e)) {
        cur.evidence.push(e);
      }
    } else {
      out.push({ id, evidence: [e] });
    }
  };
  const pj = path.join(root, "package.json");
  if (existsSync(pj)) {
    push("node", pj);
  }
  const py = path.join(root, "pyproject.toml");
  if (existsSync(py)) {
    push("python", py);
  }
  const rs = path.join(root, "Cargo.toml");
  if (existsSync(rs)) {
    push("rust", rs);
  }
  const go = path.join(root, "go.mod");
  if (existsSync(go)) {
    push("go", go);
  }
  const gem = path.join(root, "Gemfile");
  if (existsSync(gem)) {
    push("ruby", gem);
  }
  for (const id of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const p = path.join(root, id);
    if (existsSync(p)) {
      push("jvm", p);
    }
  }
  for (const s of out) {
    s.evidence.sort();
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function collectWorkspace(root: string): AdoptionWorkspaceTooling {
  const evidence: string[] = [];
  let pnpm = false;
  let turbo = false;
  let changesets = false;
  const note = (p: string) => {
    const r = rel(root, p);
    if (!evidence.includes(r)) {
      evidence.push(r);
    }
  };
  const lock = path.join(root, "pnpm-lock.yaml");
  if (existsSync(lock)) {
    pnpm = true;
    note(lock);
  }
  const pkgPath = path.join(root, "package.json");
  const pkg = readJsonIfPresent(pkgPath);
  if (pkg) {
    const pm = pkg.packageManager;
    if (typeof pm === "string" && pm.startsWith("pnpm@")) {
      pnpm = true;
      note(pkgPath);
    }
    if (hasDepKey(pkg, "turbo")) {
      turbo = true;
      note(pkgPath);
    }
    if (hasDepKey(pkg, "@changesets/cli")) {
      changesets = true;
      note(pkgPath);
    }
  }
  const turboJson = path.join(root, "turbo.json");
  if (existsSync(turboJson)) {
    turbo = true;
    note(turboJson);
  }
  const changesetDir = path.join(root, ".changeset");
  if (existsSync(changesetDir)) {
    changesets = true;
    note(changesetDir);
  }
  evidence.sort();
  return { pnpm, turbo, changesets, evidence };
}

function collectCi(root: string): AdoptionCiSignal {
  const wfDir = path.join(root, ".github", "workflows");
  if (!existsSync(wfDir)) {
    return { githubWorkflows: false, evidence: [] };
  }
  let names: string[];
  try {
    names = readdirSync(wfDir);
  } catch {
    return { githubWorkflows: false, evidence: [] };
  }
  const yamlish = names.filter(
    (n) => n.endsWith(".yml") || n.endsWith(".yaml") || n.endsWith(".yaml.disabled"),
  );
  if (yamlish.length === 0) {
    return { githubWorkflows: false, evidence: [rel(root, wfDir)] };
  }
  const evidence = [rel(root, wfDir), ...yamlish.map((n) => rel(root, path.join(wfDir, n)))].sort();
  return { githubWorkflows: true, evidence };
}

function collectTestFrameworks(root: string): AdoptionTestFrameworkSignal {
  const evidence: string[] = [];
  const pkgPath = path.join(root, "package.json");
  const pkg = readJsonIfPresent(pkgPath);
  let vitest = false;
  let jest = false;
  if (pkg) {
    if (hasDepKey(pkg, "vitest")) {
      vitest = true;
      evidence.push(rel(root, pkgPath));
    }
    if (hasDepKey(pkg, "jest") || hasDepKey(pkg, "@jest/globals")) {
      jest = true;
      evidence.push(rel(root, pkgPath));
    }
  }
  evidence.sort();
  return { vitest, jest, evidence: [...new Set(evidence)] };
}

/** Performs a shallow, presence-only scan suitable for adoption proposals. */
export async function scanRepository(rootPath: string): Promise<AdoptionScanReport> {
  const root = path.resolve(rootPath);
  const ci = collectCi(root);
  const languages = collectLanguages(root);
  const workspaceTooling = collectWorkspace(root);
  const testFrameworks = collectTestFrameworks(root);
  return {
    rootPath: root,
    languages,
    workspaceTooling,
    ci,
    testFrameworks,
    scannedAtIso: new Date().toISOString(),
  };
}
