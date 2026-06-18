import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";
import type { ActiveMemorySnapshot } from "./run-state-shared";

export type { ActiveMemorySnapshot } from "./run-state-shared";

const ACTIVE_MEMORY_REL = "lib/memory/active/current.md";
const INBOX_ROOT_PREFIX = "lib/inbox/in/";
const CHIP_MAX_LENGTH = 60;

function extractSectionBody(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const target = `## ${heading}`;
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() === target) {
      start = index + 1;
      break;
    }
  }

  if (start === -1) {
    return "";
  }

  const bodyLines: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      break;
    }
    bodyLines.push(line);
  }

  return bodyLines.join("\n").trim();
}

function extractActiveFeaturePath(sectionBody: string): string | null {
  for (const line of sectionBody.split("\n")) {
    const match = line.match(/`([^`]+)`/u);
    if (match?.[1] !== undefined && match[1].length > 0) {
      const value = match[1].trim();
      if (value === "(none)") {
        return null;
      }
      return value;
    }
  }
  return null;
}

function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .trim();
}

function truncateChipLabel(label: string): string {
  const compact = label.trim();
  if (compact.length <= CHIP_MAX_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, CHIP_MAX_LENGTH - 1)}…`;
}

function deriveSlugFromFilename(fileName: string): string {
  const base = fileName.replace(/\.md$/iu, "");
  const semanticMatch = base.match(/^\d+_\d+_(.+)$/u);
  if (semanticMatch?.[1] !== undefined) {
    return semanticMatch[1];
  }
  return base;
}

function extractTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim() || fallback;
    }
  }
  return fallback;
}

function parseBlockerChips(sectionBody: string): string[] {
  const listItems = sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => stripMarkdownEmphasis(line.replace(/^-\s+/u, "")))
    .filter((line) => line.length > 0)
    .map(truncateChipLabel);

  if (listItems.length > 0) {
    return listItems;
  }

  const compact = stripMarkdownEmphasis(sectionBody.replace(/\s+/gu, " "));
  if (compact.length === 0) {
    return [];
  }

  const splitCandidates = compact
    .split(/\s*[·•]\s*|\.\s+(?=[A-Z])/u)
    .map((part) => truncateChipLabel(part))
    .filter((part) => part.length > 0);

  return splitCandidates.length > 0 ? splitCandidates : [truncateChipLabel(compact)];
}

function summarizeBlockers(sectionBody: string): string {
  const chips = parseBlockerChips(sectionBody);
  if (chips.length === 0) {
    return "";
  }
  const joined = chips.slice(0, 3).join(" · ");
  return joined.length > 240 ? `${joined.slice(0, 237)}…` : joined;
}

function extractRefreshTimestamp(markdown: string): string | null {
  const match = markdown.match(
    /Active-memory refreshed \(UTC\):\s*`([^`]+)`/u,
  );
  return match?.[1]?.trim() ?? null;
}

async function resolveActiveFeatureMetadata(
  repoRoot: string,
  activeFeaturePath: string | null,
): Promise<{ label: string | null; slug: string | null }> {
  if (activeFeaturePath === null) {
    return { label: null, slug: null };
  }

  const fileName = path.basename(activeFeaturePath);
  const slug = deriveSlugFromFilename(fileName);

  if (!activeFeaturePath.startsWith(INBOX_ROOT_PREFIX)) {
    return { label: slug, slug };
  }

  try {
    const absolutePath = path.join(repoRoot, activeFeaturePath);
    const markdown = await fsp.readFile(absolutePath, "utf8");
    const title = extractTitle(markdown, slug);
    return { label: title, slug };
  } catch {
    return { label: slug, slug };
  }
}

export async function loadActiveMemory(
  repoRoot: string = findRepoRoot(),
): Promise<ActiveMemorySnapshot> {
  const absolutePath = path.join(repoRoot, ACTIVE_MEMORY_REL);
  const markdown = await fsp.readFile(absolutePath, "utf8");

  const activeFeatureSection = extractSectionBody(markdown, "Active Feature");
  const blockersSection = extractSectionBody(markdown, "Risks and blockers");
  const activeFeaturePath = extractActiveFeaturePath(activeFeatureSection);
  const { label, slug } = await resolveActiveFeatureMetadata(repoRoot, activeFeaturePath);
  const blockerChips = parseBlockerChips(blockersSection);

  return {
    activeFeaturePath,
    activeFeatureLabel: label,
    activeFeatureSlug: slug,
    blockersSummary: summarizeBlockers(blockersSection),
    blockerChips,
    refreshTimestamp: extractRefreshTimestamp(markdown),
  };
}
