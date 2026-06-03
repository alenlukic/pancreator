import { projectRootAbs } from "@pancreator/core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCursorSync } from "./cursor-sync.js";

export interface EmbeddedInstallManifest {
  allow: string[];
  harness_root_allow: string[];
  deny_prefixes: string[];
}

const MANIFEST_REL = "lib/memory/handbook/embedded-install-manifest.yaml";

export function embeddedManifestPath(harnessRoot: string): string {
  return path.join(path.resolve(harnessRoot), MANIFEST_REL);
}

function parseEmbeddedInstallManifest(raw: string): EmbeddedInstallManifest {
  const doc: EmbeddedInstallManifest = { allow: [], harness_root_allow: [], deny_prefixes: [] };
  let section: keyof EmbeddedInstallManifest | null = null;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "allow:") {
      section = "allow";
      continue;
    }
    if (trimmed === "harness_root_allow:") {
      section = "harness_root_allow";
      continue;
    }
    if (trimmed === "deny_prefixes:") {
      section = "deny_prefixes";
      continue;
    }
    const match = /^-\s+(.+)$/u.exec(trimmed);
    if (match && section) {
      doc[section].push(match[1]!);
    }
  }
  return doc;
}

export function loadEmbeddedInstallManifest(harnessRoot: string): EmbeddedInstallManifest {
  const raw = readFileSync(embeddedManifestPath(harnessRoot), "utf8");
  return parseEmbeddedInstallManifest(raw);
}

/** Resolves manifest from the running package when harness copy is absent (tests). */
export function loadEmbeddedInstallManifestFromRepo(harnessRoot: string): EmbeddedInstallManifest {
  try {
    return loadEmbeddedInstallManifest(harnessRoot);
  } catch {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fallback = path.resolve(here, "..", "..", "..", "..", "..", "..", MANIFEST_REL);
    const raw = readFileSync(fallback, "utf8");
    return parseEmbeddedInstallManifest(raw);
  }
}

export function pathMatchesDenyPrefix(relPosix: string, denyPrefixes: string[]): string | null {
  const norm = relPosix.replace(/\\/gu, "/").replace(/^\/+/u, "");
  for (const prefix of denyPrefixes) {
    const p = prefix.replace(/\\/gu, "/");
    if (norm === p || norm.startsWith(p) || norm.includes(p)) {
      return prefix;
    }
  }
  return null;
}

const GREENFIELD_PANCREATOR_YAML = `project_root: "."
bootstrap:
  phase: "5"
  status: phase-5-in-progress
  completed_phases: ["-1", "0", "1", "2", "3", "4"]
risk_tier: medium
`;

const EMBEDDED_PANCREATOR_YAML = `project_root: ".pancreator"
runner:
  cursor:
    invocation: sdk
risk_tier: medium
`;

const GREENFIELD_SCAFFOLD: Record<string, string> = {
  "pancreator.yaml": GREENFIELD_PANCREATOR_YAML,
  "AGENTS.md": "# AGENTS.md\n\nOperator card for this Pancreator workspace.\n",
  "lib/memory/active/current.md": "# Active memory\n\n## Active Feature\n\n- `(none)`\n",
  "lib/pipelines/feature-delivery.yaml": `id: feature-delivery
version: "1"
stages:
  - id: intake
    persona: intake-analyst
  - id: plan
    persona: tech-lead
  - id: implement
    persona: coder
  - id: review
    persona: reviewer
  - id: test
    persona: qa-tester
  - id: report
    persona: tech-writer
  - id: compliance
    persona: compliance-auditor
  - id: ship
    persona: supervisor
  - id: index
    persona: librarian
`,
};

function embeddedScaffoldEntries(manifest: EmbeddedInstallManifest): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rel of manifest.allow) {
    const norm = rel.replace(/\/$/u, "");
    if (norm.endsWith("/") || rel.endsWith("/")) {
      entries[`${norm}/.gitkeep`] = "";
    } else {
      entries[norm] = "";
    }
  }
  entries["lib/memory/active/current.md"] =
    "# Active memory\n\n## Active Feature\n\n- `(none)`\n";
  entries["lib/pipelines/feature-delivery.yaml"] = GREENFIELD_SCAFFOLD["lib/pipelines/feature-delivery.yaml"]!;
  return entries;
}

export type InitMode = "greenfield" | "embedded";

export function detectInitMode(harnessRoot: string): InitMode {
  return existsSync(path.join(path.resolve(harnessRoot), "AGENTS.md")) ? "embedded" : "greenfield";
}

export interface PanInitInput {
  repoRoot: string;
  dryRun?: boolean;
  apply?: boolean;
  force?: boolean;
  clock?: () => Date;
  mode?: InitMode;
}

export interface PanInitFileDiff {
  path: string;
  scope: "harness_root" | "project_root";
  action: "create" | "skip" | "conflict";
}

export interface PanInitSeedSummary {
  count: number;
  source: "package";
}

export interface PanInitCursorSyncSummary {
  count: number;
  written: Array<{ path: string; action: string }>;
}

export interface PanInitResult {
  command: "init";
  status: "ok" | "partial";
  mode: InitMode;
  dryRun: boolean;
  applied: boolean;
  diffs: PanInitFileDiff[];
  harnessRootConflicts?: PanInitFileDiff[];
  projectRootConflicts?: PanInitFileDiff[];
  adoptionReport?: string;
  inboxRatificationItem?: string;
  personaSeed?: PanInitSeedSummary;
  handbookSeed?: PanInitSeedSummary;
  cursorSync?: PanInitCursorSyncSummary | "skipped-no-personas";
}

const INBOX_QUEUE_DIRS = ["in", "out", "threads", "notes"] as const;

function utcDayStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function initProjectRootAbs(harnessRoot: string, mode: InitMode): string {
  if (mode === "embedded") {
    return projectRootAbs(harnessRoot, ".pancreator");
  }
  return path.resolve(harnessRoot);
}

function resolveScaffoldAbs(
  harnessRoot: string,
  mode: InitMode,
  rel: string,
  scope: "harness_root" | "project_root",
): string {
  if (scope === "harness_root") {
    return path.join(path.resolve(harnessRoot), rel);
  }
  return path.join(initProjectRootAbs(harnessRoot, mode), rel);
}

function buildScaffoldPlan(
  harnessRoot: string,
  mode: InitMode,
  manifest: EmbeddedInstallManifest,
): Array<{ rel: string; scope: "harness_root" | "project_root"; content: string }> {
  if (mode === "greenfield") {
    return Object.entries(GREENFIELD_SCAFFOLD).map(([rel, content]) => ({
      rel,
      scope: "harness_root" as const,
      content,
    }));
  }

  const plan: Array<{ rel: string; scope: "harness_root" | "project_root"; content: string }> = [
    { rel: "pancreator.yaml", scope: "harness_root", content: EMBEDDED_PANCREATOR_YAML },
  ];
  for (const rel of manifest.harness_root_allow) {
    if (rel === "pancreator.yaml") continue;
    const harnessRel = rel.endsWith("/") ? `${rel}.gitkeep` : rel;
    plan.push({ rel: harnessRel, scope: "harness_root", content: "" });
  }
  for (const [rel, content] of Object.entries(embeddedScaffoldEntries(manifest))) {
    const deny = pathMatchesDenyPrefix(rel, manifest.deny_prefixes);
    if (deny) {
      throw new Error(`embedded scaffold plan includes deny-listed path ${rel} (matches ${deny})`);
    }
    plan.push({ rel, scope: "project_root", content });
  }
  return plan;
}

async function ensureInboxLayout(harnessRoot: string, mode: InitMode): Promise<void> {
  const projectRoot = initProjectRootAbs(harnessRoot, mode);
  await Promise.all(
    INBOX_QUEUE_DIRS.map((queue) =>
      mkdir(path.join(projectRoot, "lib", "inbox", queue), { recursive: true }),
    ),
  );
}

function resolvePackageHarnessRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "..", "..");
}

function directoryNeedsSeeding(dir: string): boolean {
  if (!existsSync(dir)) {
    return true;
  }
  return readdirSync(dir).filter((name) => name.endsWith(".md")).length === 0;
}

async function walkPackageSeedFiles(
  sourceDir: string,
  sourceRoot: string,
  denyPrefixes: string[],
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(sourceDir, entry.name);
    const rel = path.relative(sourceRoot, abs).replace(/\\/gu, "/");
    if (pathMatchesDenyPrefix(rel, denyPrefixes) !== null) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkPackageSeedFiles(abs, sourceRoot, denyPrefixes)));
      continue;
    }
    if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files;
}

async function copyPackageSeedTree(
  sourceRel: string,
  targetDir: string,
  denyPrefixes: string[],
): Promise<number> {
  const harness = resolvePackageHarnessRoot();
  const sourceDir = path.join(harness, sourceRel);
  if (!existsSync(sourceDir)) {
    return 0;
  }
  const files = await walkPackageSeedFiles(sourceDir, sourceDir, denyPrefixes);
  let count = 0;
  for (const sourceAbs of files) {
    const rel = path.relative(sourceDir, sourceAbs);
    const targetAbs = path.join(targetDir, rel);
    await mkdir(path.dirname(targetAbs), { recursive: true });
    await copyFile(sourceAbs, targetAbs);
    count += 1;
  }
  return count;
}

function countPersonaSpecs(personasDir: string): number {
  if (!existsSync(personasDir)) {
    return 0;
  }
  return readdirSync(personasDir).filter((name) => name.endsWith(".md")).length;
}

async function seedEmbeddedContent(
  harnessRoot: string,
  manifest: EmbeddedInstallManifest,
): Promise<{ personaSeed?: PanInitSeedSummary; handbookSeed?: PanInitSeedSummary }> {
  const projectRoot = initProjectRootAbs(harnessRoot, "embedded");
  const personasDir = path.join(projectRoot, "lib", "personas");
  const handbookDir = path.join(projectRoot, "lib", "memory", "handbook");
  const result: { personaSeed?: PanInitSeedSummary; handbookSeed?: PanInitSeedSummary } = {};

  if (directoryNeedsSeeding(personasDir)) {
    const count = await copyPackageSeedTree("lib/personas", personasDir, manifest.deny_prefixes);
    if (count > 0) {
      result.personaSeed = { count, source: "package" };
    }
  }

  if (directoryNeedsSeeding(handbookDir)) {
    const count = await copyPackageSeedTree(
      "lib/memory/handbook",
      handbookDir,
      manifest.deny_prefixes,
    );
    if (count > 0) {
      result.handbookSeed = { count, source: "package" };
    }
  }

  return result;
}

function runEmbeddedCursorSync(
  harnessRoot: string,
  manifest: EmbeddedInstallManifest,
  dryRun: boolean,
): PanInitResult["cursorSync"] {
  if (!manifest.harness_root_allow.includes(".cursor/agents/")) {
    return "skipped-no-personas";
  }
  const projectRoot = initProjectRootAbs(harnessRoot, "embedded");
  const personasDir = path.join(projectRoot, "lib", "personas");
  if (countPersonaSpecs(personasDir) === 0) {
    return "skipped-no-personas";
  }
  const sync = runCursorSync(harnessRoot, { dryRun });
  return { count: sync.count, written: sync.written };
}

export async function runPanInit(input: PanInitInput): Promise<PanInitResult> {
  const harnessRoot = path.resolve(input.repoRoot);
  const dryRun = input.dryRun ?? !input.apply;
  const force = input.force ?? false;
  const mode = input.mode ?? detectInitMode(harnessRoot);
  const manifest =
    mode === "embedded"
      ? loadEmbeddedInstallManifestFromRepo(harnessRoot)
      : { allow: [], harness_root_allow: [], deny_prefixes: [] };
  const plan = buildScaffoldPlan(harnessRoot, mode, manifest);
  const diffs: PanInitFileDiff[] = [];

  for (const entry of plan) {
    const abs = resolveScaffoldAbs(harnessRoot, mode, entry.rel, entry.scope);
    const deny =
      entry.scope === "project_root"
        ? pathMatchesDenyPrefix(entry.rel, manifest.deny_prefixes)
        : null;
    if (deny) {
      const err = new Error(`pan init refused: deny-listed path ${entry.rel} (matches ${deny})`) as Error & {
        exitCode?: number;
      };
      err.exitCode = 1;
      throw err;
    }

    if (existsSync(abs)) {
      if (force) {
        diffs.push({ path: entry.rel, scope: entry.scope, action: "create" });
        if (!dryRun) {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, entry.content, "utf8");
        }
      } else {
        diffs.push({ path: entry.rel, scope: entry.scope, action: "conflict" });
      }
      continue;
    }
    diffs.push({ path: entry.rel, scope: entry.scope, action: "create" });
    if (!dryRun) {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, entry.content, "utf8");
    }
  }

  const harnessRootConflicts = diffs.filter((d) => d.scope === "harness_root" && d.action === "conflict");
  const projectRootConflicts = diffs.filter((d) => d.scope === "project_root" && d.action === "conflict");
  const allConflicts = diffs.filter((d) => d.action === "conflict");

  const onlyHarnessYamlConflict =
    mode === "embedded" &&
    harnessRootConflicts.length === 1 &&
    harnessRootConflicts[0]?.path === "pancreator.yaml" &&
    projectRootConflicts.length === 0;

  if (allConflicts.length > 0 && !force && !onlyHarnessYamlConflict) {
    const err = new Error(
      `pan init refused: ${allConflicts.length} conflicting file(s). Re-run with --force to overwrite.`,
    ) as Error & { exitCode?: number };
    err.exitCode = 1;
    throw err;
  }

  let personaSeed: PanInitSeedSummary | undefined;
  let handbookSeed: PanInitSeedSummary | undefined;
  let cursorSync: PanInitResult["cursorSync"];

  if (mode === "embedded" && dryRun) {
    cursorSync = runEmbeddedCursorSync(harnessRoot, manifest, true);
  }

  let applied = false;
  if (!dryRun) {
    applied = true;
    await ensureInboxLayout(harnessRoot, mode);

    if (mode === "embedded") {
      const seeded = await seedEmbeddedContent(harnessRoot, manifest);
      personaSeed = seeded.personaSeed;
      handbookSeed = seeded.handbookSeed;
      cursorSync = runEmbeddedCursorSync(harnessRoot, manifest, false);
    }

    const now = input.clock?.() ?? new Date();
    const day = utcDayStamp(now);
    const projectRoot = initProjectRootAbs(harnessRoot, mode);
    const adoptionDir = path.join(projectRoot, "lib", "memory", "adoption");
    await mkdir(adoptionDir, { recursive: true });
    const adoptionReport = path.posix.join("lib", "memory", "adoption", `scan-${day}.md`);
    const reportBody = [
      "# Adoption scan",
      "",
      `- scanned_at: ${now.toISOString()}`,
      "- languages: []",
      "- frameworks: []",
      "- proposed_threshold_policy: defaults.medium",
      "",
    ].join("\n");
    await writeFile(path.join(projectRoot, adoptionReport), reportBody, "utf8");

    const inboxDir = path.join(projectRoot, "lib", "inbox", "in", day.replace(/-/g, "").slice(2));
    await mkdir(inboxDir, { recursive: true });
    const sid = String(86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()));
    const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
    const ratName = `${sid}_${hhmm}_init-ratification.md`;
    const inboxRatificationItem = path.posix.join("lib", "inbox", "in", path.basename(inboxDir), ratName);
    await writeFile(
      path.join(projectRoot, inboxRatificationItem),
      `# Init ratification\n\nReview adoption scan at ${adoptionReport}.\n`,
      "utf8",
    );

    return {
      command: "init",
      status: onlyHarnessYamlConflict ? "partial" : "ok",
      mode,
      dryRun,
      applied,
      diffs,
      harnessRootConflicts,
      projectRootConflicts,
      adoptionReport,
      inboxRatificationItem,
      ...(personaSeed !== undefined ? { personaSeed } : {}),
      ...(handbookSeed !== undefined ? { handbookSeed } : {}),
      ...(cursorSync !== undefined ? { cursorSync } : {}),
    };
  }

  return {
    command: "init",
    status: harnessRootConflicts.length > 0 || projectRootConflicts.length > 0 ? "partial" : "ok",
    mode,
    dryRun,
    applied: false,
    diffs,
    ...(harnessRootConflicts.length > 0 ? { harnessRootConflicts } : {}),
    ...(projectRootConflicts.length > 0 ? { projectRootConflicts } : {}),
    ...(personaSeed !== undefined ? { personaSeed } : {}),
    ...(handbookSeed !== undefined ? { handbookSeed } : {}),
    ...(cursorSync !== undefined ? { cursorSync } : {}),
  };
}

export interface CreatePancreatorInput {
  targetDir: string;
  projectName: string;
  clock?: () => Date;
}

export interface CreatePancreatorResult {
  command: "create-pancreator";
  status: "ok";
  targetDir: string;
  projectName: string;
  init: PanInitResult;
}

export async function runCreatePancreator(input: CreatePancreatorInput): Promise<CreatePancreatorResult> {
  const targetDir = path.resolve(input.targetDir, input.projectName);
  if (existsSync(targetDir)) {
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`create-pancreator: target directory is not empty: ${targetDir}`);
    }
  } else {
    await mkdir(targetDir, { recursive: true });
  }
  const init = await runPanInit({
    repoRoot: targetDir,
    apply: true,
    mode: "greenfield",
    clock: input.clock,
  });
  const sampleInbox = path.join(targetDir, "lib", "inbox", "in", "sample-directive.md");
  if (!existsSync(sampleInbox)) {
    await mkdir(path.dirname(sampleInbox), { recursive: true });
    await writeFile(
      sampleInbox,
      "# Sample feature\n\nWalk through feature-delivery with `pnpm -w exec pan run feature-delivery sample-directive.md`.\n",
      "utf8",
    );
  }
  return {
    command: "create-pancreator",
    status: "ok",
    targetDir,
    projectName: input.projectName,
    init,
  };
}

/** Reads `runner.cursor.model_escalation.config` from pancreator.yaml when present. */
export async function readModelEscalationConfigName(repoRoot: string): Promise<string | undefined> {
  const cfgPath = path.join(repoRoot, "pancreator.yaml");
  if (!existsSync(cfgPath)) {
    return undefined;
  }
  const raw = await readFile(cfgPath, "utf8");
  const blockMatch = /runner:\s*\n(?:\s+.+\n)*?\s+cursor:\s*\n(?:\s+.+\n)*?\s+model_escalation:\s*\n(?:\s+.+\n)*?\s+config:\s*(\S+)/u.exec(
    raw,
  );
  if (blockMatch?.[1] !== undefined) {
    return blockMatch[1].replace(/^["']|["']$/gu, "");
  }
  const flatMatch = /runner\.cursor\.model_escalation\.config:\s*(\S+)/u.exec(raw);
  return flatMatch?.[1]?.replace(/^["']|["']$/gu, "");
}

/** Reads `runner.cursor.invocation` from pancreator.yaml when present. */
export async function readCursorInvocationMode(repoRoot: string): Promise<"manual" | "sdk"> {
  const cfgPath = path.join(repoRoot, "pancreator.yaml");
  if (!existsSync(cfgPath)) return "manual";
  const raw = await readFile(cfgPath, "utf8");
  const match = /runner:\s*\n(?:\s+.+\n)*?\s+cursor:\s*\n(?:\s+.+\n)*?\s+invocation:\s*(manual|sdk)/u.exec(raw);
  if (match?.[1] === "sdk") return "sdk";
  if (/runner\.cursor\.invocation:\s*sdk/u.test(raw)) return "sdk";
  return "manual";
}

/** Reads `runner.cursor.stage_remediation`; defaults to true when invocation is sdk. */
export async function readStageRemediationEnabled(
  repoRoot: string,
  options?: { ledgerInvocation?: "manual" | "sdk" },
): Promise<boolean> {
  const cfgPath = path.join(repoRoot, "pancreator.yaml");
  let invocation = await readCursorInvocationMode(repoRoot);
  if (invocation === "manual" && !existsSync(cfgPath) && options?.ledgerInvocation === "sdk") {
    invocation = "sdk";
  }
  if (invocation !== "sdk") {
    return false;
  }
  if (!existsSync(cfgPath)) {
    return true;
  }
  const raw = await readFile(cfgPath, "utf8");
  if (/stage_remediation:\s*false/u.test(raw)) {
    return false;
  }
  return true;
}
