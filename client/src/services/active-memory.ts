import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";
import type { ActiveMemorySnapshot } from "./run-state-shared";

export type { ActiveMemorySnapshot } from "./run-state-shared";

const ACTIVE_MEMORY_REL = "lib/memory/active/current.md";

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
      return match[1];
    }
  }
  return null;
}

function summarizeBlockers(sectionBody: string): string {
  const listItems = sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\s+/u, "").trim())
    .filter((line) => line.length > 0);

  if (listItems.length === 0) {
    const compact = sectionBody.replace(/\s+/gu, " ").trim();
    if (compact.length === 0) {
      return "";
    }
    return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
  }

  const firstThree = listItems.slice(0, 3).join(" · ");
  return firstThree.length > 240 ? `${firstThree.slice(0, 237)}…` : firstThree;
}

function extractRefreshTimestamp(markdown: string): string | null {
  const match = markdown.match(
    /Active-memory refreshed \(UTC\):\s*`([^`]+)`/u,
  );
  return match?.[1]?.trim() ?? null;
}

export async function loadActiveMemory(
  repoRoot: string = findRepoRoot(),
): Promise<ActiveMemorySnapshot> {
  const absolutePath = path.join(repoRoot, ACTIVE_MEMORY_REL);
  const markdown = await fsp.readFile(absolutePath, "utf8");

  const activeFeatureSection = extractSectionBody(markdown, "Active Feature");
  const blockersSection = extractSectionBody(markdown, "Risks and blockers");

  return {
    activeFeaturePath: extractActiveFeaturePath(activeFeatureSection),
    blockersSummary: summarizeBlockers(blockersSection),
    refreshTimestamp: extractRefreshTimestamp(markdown),
  };
}
