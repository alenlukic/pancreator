import { quoteJsonString } from "@pancreator/core";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findRepoRoot } from "./repo-paths";

const execFileAsync = promisify(execFile);

const SHELL_METACHAR_PATTERN = /[;&|`$()<>\n\r\0]/u;
const INBOX_ROOT_PREFIX = "lib/inbox/in/";
const URL_FETCH_TIMEOUT_MS = 8000;

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

export type KickoffSaveResult = {
  path: string;
};

export type KickoffUrlSummary = {
  title: string;
  excerpt: string;
  directiveSeed: string;
};

export type KickoffLaunchResult = {
  taskId: string;
  featureId: string;
  runDir: string;
  handoffFile: string;
};

export type KickoffLaunchInput = {
  inboxPath: string;
  repoRoot?: string;
  launchRunner?: (inboxRelative: string, repoRoot: string) => Promise<KickoffLaunchResult>;
};

export type KickoffSaveInput = {
  markdown: string;
  slug?: string;
  repoRoot?: string;
  now?: Date;
};

export type KickoffUrlInput = {
  url: string;
  fetchImpl?: typeof fetch;
};

function makeUtcDayBucket(now: Date): string {
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

function secondsToMidnightUtc(now: Date): number {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const nextDayStart = dayStart + 86400000;
  return Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
}

function utcHhmm(now: Date): string {
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

export function slugifyIntakeBasename(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (normalized.length === 0) {
    return "kickoff-directive";
  }
  return SLUG_PATTERN.test(normalized) ? normalized : "kickoff-directive";
}

export function extractTitleFromMarkdown(markdown: string, fallback: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim() || fallback;
    }
  }
  const frontmatterTitle = markdown.match(/^title:\s*(.+)$/mu)?.[1]?.trim();
  if (frontmatterTitle !== undefined && frontmatterTitle.length > 0) {
    return frontmatterTitle.replace(/^["']|["']$/gu, "");
  }
  return fallback;
}

export function assertValidInboxPath(repoRelativePath: string): string {
  const normalized = repoRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith(INBOX_ROOT_PREFIX)) {
    throw new Error("Inbox path must start with lib/inbox/in/");
  }
  if (SHELL_METACHAR_PATTERN.test(normalized)) {
    throw new Error("Shell metacharacters are not allowed in inbox paths");
  }
  if (normalized.includes("..")) {
    throw new Error("Path traversal is not allowed");
  }
  return normalized;
}

export function inboxRelativeFromRepoPath(repoRelativePath: string): string {
  const normalized = assertValidInboxPath(repoRelativePath);
  return normalized.slice(INBOX_ROOT_PREFIX.length);
}

export function assertValidHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (SHELL_METACHAR_PATTERN.test(trimmed)) {
    throw new Error("Shell metacharacters are not allowed in URLs");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("URL must be valid HTTP or HTTPS");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS");
  }
  return parsed.toString();
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/iu);
  return match?.[1]?.trim() ?? "Untitled page";
}

function extractHtmlExcerpt(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.slice(0, 400);
}

export function buildUrlDirectiveSeed(title: string, excerpt: string, sourceUrl: string): string {
  const createdIso = new Date().toISOString();
  const featureId = slugifyIntakeBasename(title);
  return [
    "---",
    `title: ${quoteJsonString(title)}`,
    `feature_id: ${quoteJsonString(featureId)}`,
    "stage: plan",
    "owner: product-engineer",
    "status: open",
    `created_at: ${quoteJsonString(createdIso)}`,
    `source_url: ${quoteJsonString(sourceUrl)}`,
    "references: []",
    "---",
    "",
    `# ${title}`,
    "",
    "## Problem",
    "",
    excerpt,
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

export async function saveKickoffDirective(input: KickoffSaveInput): Promise<KickoffSaveResult> {
  const repoRoot = input.repoRoot ?? findRepoRoot();
  const markdown = input.markdown.trim();
  if (markdown.length === 0) {
    throw new Error("Directive markdown is required");
  }

  const title = extractTitleFromMarkdown(markdown, "Kickoff directive");
  const slug = input.slug ?? slugifyIntakeBasename(title);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("slug MUST use lowercase letters, digits, underscores, or hyphens");
  }

  const now = input.now ?? new Date();
  const dayBucket = makeUtcDayBucket(now);
  const sid = secondsToMidnightUtc(now);
  const hhmm = utcHhmm(now);
  const targetRel = path.posix.join(INBOX_ROOT_PREFIX, dayBucket, `${sid}_${hhmm}_${slug}.md`);
  const targetAbs = path.join(repoRoot, targetRel);

  if (fs.existsSync(targetAbs)) {
    throw new Error(`Refusing to overwrite existing inbox directive at ${targetRel}.`);
  }

  await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
  await fsp.writeFile(targetAbs, `${markdown.trimEnd()}\n`, "utf8");
  return { path: targetRel };
}

export async function summarizeKickoffUrl(input: KickoffUrlInput): Promise<KickoffUrlSummary> {
  const url = assertValidHttpUrl(input.url);
  const fetchFn = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      throw new Error(`URL fetch failed with status ${response.status}`);
    }
    const html = await response.text();
    const title = extractHtmlTitle(html);
    const excerpt = extractHtmlExcerpt(html);
    return {
      title,
      excerpt,
      directiveSeed: buildUrlDirectiveSeed(title, excerpt, url),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultLaunchRunner(
  inboxRelative: string,
  repoRoot: string,
): Promise<KickoffLaunchResult> {
  if (SHELL_METACHAR_PATTERN.test(inboxRelative)) {
    throw new Error("Shell metacharacters are not allowed in inbox paths");
  }

  const { stdout } = await execFileAsync(
    "pnpm",
    ["-w", "exec", "pan", "run", "feature-delivery", inboxRelative, "--format", "json"],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );

  const envelope = JSON.parse(stdout.trim()) as KickoffLaunchResult & {
    status?: string;
    error?: string;
  };

  if (
    envelope.taskId === undefined ||
    envelope.featureId === undefined ||
    envelope.runDir === undefined ||
    envelope.handoffFile === undefined
  ) {
    throw new Error("Launch response missing required fields");
  }

  return {
    taskId: envelope.taskId,
    featureId: envelope.featureId,
    runDir: envelope.runDir,
    handoffFile: envelope.handoffFile,
  };
}

export async function launchFeatureDelivery(input: KickoffLaunchInput): Promise<KickoffLaunchResult> {
  const repoRoot = input.repoRoot ?? findRepoRoot();
  const normalized = assertValidInboxPath(input.inboxPath);
  const inboxRelative = inboxRelativeFromRepoPath(normalized);
  const inboxAbs = path.join(repoRoot, normalized);
  if (!fs.existsSync(inboxAbs)) {
    throw new Error("Inbox directive file not found");
  }

  const runner = input.launchRunner ?? defaultLaunchRunner;
  return runner(inboxRelative, repoRoot);
}
