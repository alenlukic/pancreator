import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolvePancreatorYamlPath, resolveProjectPath } from "@pancreator/core";

import { quoteJsonString } from "./canonical-json-io.js";

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

export function makeUtcDayBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const daysToFds = Math.floor((FDS_UTC_MS - dayStart) / 86400000);
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${daysToFds}_${mm}-${dd}-${yy}`;
}

/** Seconds remaining until the next UTC midnight; matches task-id SID semantics. */
export function secondsToMidnightUtc(now: Date): number {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const nextDayStart = dayStart + 86400000;
  return Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
}

export function utcHhmm(now: Date): string {
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

export function assertIntakeSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      "slug MUST use lowercase letters, digits, underscores, or hyphens starting with alphanumerics.",
    );
  }
}

/** Derives a conformant intake slug from free-form operator text. */
export function slugifyIntakeBasename(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (normalized.length === 0) {
    return "build-request";
  }
  return SLUG_PATTERN.test(normalized) ? normalized : "build-request";
}

export function buildDefaultIntakeMarkdown(opts: {
  readonly title: string;
  readonly featureId: string;
  readonly owner: string;
  readonly createdIso: string;
}): string {
  return [
    "---",
    `title: ${quoteJsonString(opts.title)}`,
    `feature_id: ${quoteJsonString(opts.featureId)}`,
    "stage: intake",
    `owner: ${quoteJsonString(opts.owner)}`,
    "status: open",
    `created_at: ${quoteJsonString(opts.createdIso)}`,
    "references: []",
    "---",
    "",
    `# ${opts.title}`,
    "",
    "## Problem",
    "",
    "## Goal",
    "",
    "## Required outcomes",
    "",
    "## Acceptance criteria",
    "",
    "## Out of scope",
    "",
  ].join("\n");
}

export function buildBuildPlanIntakeMarkdown(opts: {
  readonly title: string;
  readonly featureId: string;
  readonly owner: string;
  readonly createdIso: string;
  readonly operatorPrompt: string;
  readonly planText: string;
}): string {
  const prompt = opts.operatorPrompt.trim();
  const plan = opts.planText.trim();
  return [
    "---",
    `title: ${quoteJsonString(opts.title)}`,
    `feature_id: ${quoteJsonString(opts.featureId)}`,
    "stage: intake",
    `owner: ${quoteJsonString(opts.owner)}`,
    "status: open",
    `created_at: ${quoteJsonString(opts.createdIso)}`,
    "source_channel: cursor-build-mode",
    "references: []",
    "---",
    "",
    `# ${opts.title}`,
    "",
    "## Problem",
    "",
    prompt,
    "",
    "## Goal",
    "",
    plan.length > 0 ? plan.split(/\r?\n/u)[0]?.trim() ?? "" : "",
    "",
    "## Required outcomes",
    "",
    plan,
    "",
    "## Acceptance criteria",
    "",
    "## Out of scope",
    "",
    "## Operator prompt (Build mode)",
    "",
    prompt,
    "",
    "## Plan snapshot",
    "",
    plan,
    "",
  ].join("\n");
}

export interface CreateIntakeDirectiveInput {
  readonly repoRoot: string;
  readonly slug: string;
  readonly now?: Date;
  readonly title?: string;
  readonly owner?: string;
  readonly featureId?: string;
  readonly fileText: string;
}

export interface CreateIntakeDirectiveResult {
  readonly path: string;
  readonly abs: string;
}

export async function createIntakeDirective(
  input: CreateIntakeDirectiveInput,
): Promise<CreateIntakeDirectiveResult> {
  assertIntakeSlug(input.slug);
  if (resolvePancreatorYamlPath(input.repoRoot) === undefined) {
    throw new Error(
      "Missing pancreator.yaml under project root or repository root; run from an initialized Pancreator workspace.",
    );
  }
  const now = input.now ?? new Date();
  const dayBucket = makeUtcDayBucket(now);
  const sid = secondsToMidnightUtc(now);
  const hhmm = utcHhmm(now);
  const targetRel = path.posix.join("lib/inbox/in", dayBucket, `${sid}_${hhmm}_${input.slug}.md`);
  const targetAbs = resolveProjectPath(input.repoRoot, ...targetRel.split("/"));
  if (existsSync(targetAbs)) {
    throw new Error(`Refusing to overwrite existing inbox directive at ${targetRel}.`);
  }
  await mkdir(path.dirname(targetAbs), { recursive: true });
  await writeFile(targetAbs, `${input.fileText.trimEnd()}\n`, "utf8");
  return { path: targetRel, abs: targetAbs };
}

export async function readOptionalTextFile(repoRoot: string, relOrAbs: string): Promise<string> {
  const abs = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : resolveProjectPath(repoRoot, ...relOrAbs.split("/"));
  return readFile(abs, "utf8");
}
