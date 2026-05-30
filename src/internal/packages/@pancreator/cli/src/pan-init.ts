import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SCAFFOLD_FILES: Record<string, string> = {
  "pancreator.yaml": `project_root: "."
bootstrap:
  phase: "5"
  status: phase-5-in-progress
  completed_phases: ["-1", "0", "1", "2", "3", "4"]
risk_tier: medium
`,
  "AGENTS.md": "# AGENTS.md\n\nOperator card for this Pancreator workspace.\n",
  "src/inbox/in/.gitkeep": "",
  "src/memory/active/current.md": "# Active memory\n\n## Active Feature\n\n- `(none)`\n",
  "src/pipelines/feature-delivery.yaml": `id: feature-delivery
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
  - id: report
    persona: tech-writer
  - id: ship
    persona: supervisor
  - id: index
    persona: librarian
`,
};

export interface PanInitInput {
  repoRoot: string;
  dryRun?: boolean;
  apply?: boolean;
  force?: boolean;
  clock?: () => Date;
}

export interface PanInitFileDiff {
  path: string;
  action: "create" | "skip" | "conflict";
}

export interface PanInitResult {
  command: "init";
  status: "ok";
  dryRun: boolean;
  applied: boolean;
  diffs: PanInitFileDiff[];
  adoptionReport?: string;
  inboxRatificationItem?: string;
}

function utcDayStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runPanInit(input: PanInitInput): Promise<PanInitResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const dryRun = input.dryRun ?? !input.apply;
  const force = input.force ?? false;
  const diffs: PanInitFileDiff[] = [];

  for (const [rel, content] of Object.entries(SCAFFOLD_FILES)) {
    const abs = path.join(repoRoot, rel);
    if (existsSync(abs)) {
      if (force) {
        diffs.push({ path: rel, action: "create" });
        if (!dryRun) {
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf8");
        }
      } else {
        diffs.push({ path: rel, action: "conflict" });
      }
      continue;
    }
    diffs.push({ path: rel, action: "create" });
    if (!dryRun) {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    }
  }

  const conflicts = diffs.filter((d) => d.action === "conflict");
  if (conflicts.length > 0 && !force) {
    const err = new Error(
      `pan init refused: ${conflicts.length} conflicting file(s). Re-run with --force to overwrite.`,
    ) as Error & { exitCode?: number };
    err.exitCode = 1;
    throw err;
  }

  let adoptionReport: string | undefined;
  let inboxRatificationItem: string | undefined;
  if (!dryRun) {
    const now = input.clock?.() ?? new Date();
    const day = utcDayStamp(now);
    const adoptionDir = path.join(repoRoot, "src", "memory", "adoption");
    await mkdir(adoptionDir, { recursive: true });
    adoptionReport = path.posix.join("src", "memory", "adoption", `scan-${day}.md`);
    const reportBody = [
      "# Adoption scan",
      "",
      `- scanned_at: ${now.toISOString()}`,
      "- languages: []",
      "- frameworks: []",
      "- proposed_threshold_policy: defaults.medium",
      "",
    ].join("\n");
    await writeFile(path.join(repoRoot, adoptionReport), reportBody, "utf8");

    const inboxDir = path.join(repoRoot, "src", "inbox", "in", day.replace(/-/g, "").slice(2));
    await mkdir(inboxDir, { recursive: true });
    const sid = String(86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()));
    const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
    const ratName = `${sid}_${hhmm}_init-ratification.md`;
    inboxRatificationItem = path.posix.join("src", "inbox", "in", path.basename(inboxDir), ratName);
    await writeFile(
      path.join(repoRoot, inboxRatificationItem),
      `# Init ratification\n\nReview adoption scan at ${adoptionReport}.\n`,
      "utf8",
    );
  }

  return {
    command: "init",
    status: "ok",
    dryRun,
    applied: !dryRun,
    diffs,
    ...(adoptionReport !== undefined ? { adoptionReport } : {}),
    ...(inboxRatificationItem !== undefined ? { inboxRatificationItem } : {}),
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
    clock: input.clock,
  });
  const sampleInbox = path.join(targetDir, "src", "inbox", "in", "sample-directive.md");
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
