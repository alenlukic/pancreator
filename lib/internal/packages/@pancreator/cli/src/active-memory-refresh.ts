import { quoteJsonString, resolveProjectPath, resolveRepoPath } from "@pancreator/core";
import { existsSync } from "node:fs";
import { stringifyCliJson } from "./canonical-json-io.js";
import { durableFeatureIndexRel } from "./feature-delivery-stage-artifacts.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Exit code when computed active-memory slices disagree with observed content. */
export const PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE = 126;

/** Maximum data rows in the current.md shipped-Features ledger (full history stays in index.json). */
export const SHIPPED_LEDGER_ROW_CAP = 10;

const OPS_NOTES_AUTO_START = "<!-- pan:active-memory:operator-notes:auto -->";
const OPS_NOTES_AUTO_END = "<!-- /pan:active-memory:operator-notes:auto -->";

const CURRENT_MD_REL = "lib/memory/active/current.md";

function resolveFeatureIndexAbs(repoRoot: string, featureId: string): string {
  const durable = resolveRepoPath(repoRoot, durableFeatureIndexRel(featureId));
  if (existsSync(durable)) return durable;
  return resolveProjectPath(repoRoot, "lib", "memory", "features", featureId, "index.json");
}

interface ActiveMemorySlices {
  shippedFeaturesBody: string;
  managedOperatorNotesSlice: string;
}

interface IndexedShipRow {
  featureId: string;
  completedAtMs: number;
  row: string;
}

export interface ActiveMemoryArtifactClosureRefreshResult {
  path: string;
  activeFeatureCleared: boolean;
}

/** Inbox paths declared in the Active Feature section (human- or future agent-curated). */
function extractActiveFeatureInboxPointers(sectionInner: string): string[] {
  const out: string[] = [];
  for (const match of sectionInner.matchAll(/`((?:lib|src)\/inbox\/in\/[^`\s]+)`/g)) {
    out.push(match[1]!);
  }
  return out;
}

function normalizeInboxRel(rel: string): string {
  return rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

export function validateActiveFeatureInboxPointers(repoRoot: string, sectionInner: string): string | null {
  for (const rel of extractActiveFeatureInboxPointers(sectionInner)) {
    if (!existsSync(resolveRepoPath(repoRoot, rel))) {
      return (
        `Active Feature pointer ${quoteJsonString(rel)} is missing under lib/inbox/in/; ` +
        "set or clear the pointer manually in lib/memory/active/current.md " +
        "(pan close-artifacts clears matching pointers automatically during artifact closure)."
      );
    }
  }
  return null;
}

export function clearActiveFeaturePointerForArchivedInbox(
  sectionInner: string,
  archivedInboxSourceRel: string,
): { inner: string; cleared: boolean } {
  const archived = normalizeInboxRel(archivedInboxSourceRel);
  const pointers = extractActiveFeatureInboxPointers(sectionInner);
  if (!pointers.includes(archived)) {
    return { inner: sectionInner, cleared: false };
  }
  const remaining = pointers.filter((p) => p !== archived);
  if (remaining.length === 0) {
    return { inner: "\n- `(none)`\n", cleared: true };
  }
  const escaped = archived.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const without = sectionInner.replace(new RegExp(`\\n- \`${escaped}\`\\s*`, "gu"), "\n");
  return { inner: without.endsWith("\n") ? without : `${without}\n`, cleared: true };
}

function parseShippedAtMs(rec: Record<string, unknown>): number | null {
  const index = rec["index"];
  const handoff = rec["handoff"];
  const delivery = rec["delivery_report"];

  let candidate: unknown;
  // New schema: top-level indexed_at (used by feature-delivery pipeline close-artifacts)
  if (typeof rec["indexed_at"] === "string") {
    candidate = rec["indexed_at"];
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate as string))) {
    if (index && typeof index === "object") {
      const idx = index as Record<string, unknown>;
      candidate = idx["completed_at"];
    }
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate as string))) {
    candidate =
      handoff && typeof handoff === "object"
        ? (handoff as Record<string, unknown>)["completed_at"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate as string))) {
    const ship = rec["shipped"];
    candidate =
      ship && typeof ship === "object"
        ? (ship as Record<string, unknown>)["shipped_at_utc"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate as string))) {
    candidate =
      delivery && typeof delivery === "object"
        ? (delivery as Record<string, unknown>)["staged_at_utc"]
        : undefined;
  }
  if (typeof candidate !== "string") {
    return null;
  }
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? null : ms;
}

function truncateCell(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function readDeliverySectionObject(rec: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = rec["delivery_report"];
  return raw !== null && raw !== undefined && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : undefined;
}

function readDeliveryReportPath(rec: Record<string, unknown>): string {
  if (typeof rec["delivery_report"] === "string") {
    return rec["delivery_report"] as string;
  }
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["path"] === "string") return top["path"] as string;
  const handoff = rec["handoff"];
  if (handoff && typeof handoff === "object" && typeof (handoff as Record<string, unknown>)["delivery_report"] === "string") {
    return (handoff as Record<string, unknown>)["delivery_report"] as string;
  }
  const arts = rec["artifacts"];
  if (Array.isArray(arts)) {
    for (const item of arts) {
      if (item && typeof item === "object") {
        const role = (item as Record<string, unknown>)["role"];
        const pth = (item as Record<string, unknown>)["path"];
        if (role === "delivery-report" && typeof pth === "string") {
          return pth;
        }
      }
    }
  }
  // New schema: feature_artifacts[].kind === "delivery-report" (used by feature-delivery pipeline close-artifacts)
  const featureArts = rec["feature_artifacts"];
  if (Array.isArray(featureArts)) {
    for (const item of featureArts) {
      if (item && typeof item === "object") {
        const kind = (item as Record<string, unknown>)["kind"];
        const pth = (item as Record<string, unknown>)["path"];
        if (kind === "delivery-report" && typeof pth === "string") {
          return pth;
        }
      }
    }
  }
  return "";
}

function readOutboxStagingPath(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["staged_to_inbox_out"] === "string") {
    return top["staged_to_inbox_out"] as string;
  }
  const shipOutbox = rec["ship_outbox_artifact"];
  if (shipOutbox !== null && shipOutbox !== undefined && typeof shipOutbox === "object") {
    const outboxPath = (shipOutbox as Record<string, unknown>)["path"];
    if (typeof outboxPath === "string") {
      return outboxPath;
    }
  }
  const ship = rec["shipped"];
  if (ship && typeof ship === "object" && typeof (ship as Record<string, unknown>)["outbox_artifact"] === "string") {
    return (ship as Record<string, unknown>)["outbox_artifact"] as string;
  }
  const notifier = rec["notifier"];
  if (notifier && typeof notifier === "object" && typeof (notifier as Record<string, unknown>)["outbox_artifact"] === "string") {
    return (notifier as Record<string, unknown>)["outbox_artifact"] as string;
  }
  return "";
}

function pushInboxPathCandidate(candidates: string[], value: unknown): void {
  if (typeof value === "string" && value.trim() !== "") {
    candidates.push(normalizeInboxRel(value));
    return;
  }
  if (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["path"] === "string"
  ) {
    candidates.push(normalizeInboxRel((value as Record<string, unknown>)["path"] as string));
  }
}

function dedupeInboxCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rel of candidates) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

/** Reads explicit archive pointers recorded at ship/close time (synchronous). */
export function readExplicitArchivedInboxPointer(rec: Record<string, unknown>): string {
  if (typeof rec["archived_inbox_source"] === "string") {
    return normalizeInboxRel(rec["archived_inbox_source"] as string);
  }
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["archived_inbox_source"] === "string") {
    return normalizeInboxRel(top["archived_inbox_source"] as string);
  }
  const ship = rec["shipped"];
  if (ship && typeof ship === "object" && typeof (ship as Record<string, unknown>)["archived_inbox_source"] === "string") {
    return normalizeInboxRel((ship as Record<string, unknown>)["archived_inbox_source"] as string);
  }
  const notifier = rec["notifier"];
  if (
    notifier &&
    typeof notifier === "object" &&
    typeof (notifier as Record<string, unknown>)["inbox_source_archived_to"] === "string"
  ) {
    return normalizeInboxRel((notifier as Record<string, unknown>)["inbox_source_archived_to"] as string);
  }
  return "";
}

function collectInboxSourceCandidates(rec: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  pushInboxPathCandidate(candidates, rec["source_inbox_item"]);
  pushInboxPathCandidate(candidates, rec["source_inbox_item_prior"]);
  const intake = rec["intake"];
  if (intake && typeof intake === "object") {
    pushInboxPathCandidate(candidates, (intake as Record<string, unknown>)["source_inbox_item"]);
  }
  const artifactIndex = rec["artifact_index"];
  if (artifactIndex && typeof artifactIndex === "object") {
    const lineage = (artifactIndex as Record<string, unknown>)["lineage"];
    if (lineage && typeof lineage === "object") {
      pushInboxPathCandidate(candidates, (lineage as Record<string, unknown>)["source_inbox_item"]);
    }
  }
  return dedupeInboxCandidates(candidates);
}

async function resolveInboxInPathToArchive(
  repoRoot: string,
  inboxInRel: string,
  taskId?: string,
): Promise<string | null> {
  const basename = path.posix.basename(inboxInRel);
  const archiveInRoot = resolveProjectPath(repoRoot, ".pan/archive", "inbox", "in");
  if (!existsSync(archiveInRoot)) {
    return null;
  }

  if (taskId !== undefined) {
    const dayDirs = await readdir(archiveInRoot, { withFileTypes: true });
    for (const day of dayDirs) {
      if (!day.isDirectory()) continue;
      const candidateRel = path.posix.join(".pan/archive", "inbox", "in", day.name, taskId, basename);
      if (existsSync(resolveRepoPath(repoRoot, candidateRel))) {
        return candidateRel;
      }
    }
  }

  const dayDirs = await readdir(archiveInRoot, { withFileTypes: true });
  for (const day of dayDirs) {
    if (!day.isDirectory()) continue;
    const dayAbs = path.join(archiveInRoot, day.name);
    const nested = await readdir(dayAbs, { withFileTypes: true });
    for (const entry of nested) {
      if (!entry.isDirectory()) {
        if (entry.name === basename) {
          return path.posix.join(".pan/archive", "inbox", "in", day.name, basename);
        }
        continue;
      }
      const candidateRel = path.posix.join(".pan/archive", "inbox", "in", day.name, entry.name, basename);
      if (existsSync(resolveRepoPath(repoRoot, candidateRel))) {
        return candidateRel;
      }
    }
  }
  return null;
}

/**
 * Resolves the archived inbox source for a feature index record, preferring on-disk
 * archive paths and falling back to lineage fields when closure predates index backfill.
 */
export async function resolveArchivedInboxPointer(
  repoRoot: string,
  rec: Record<string, unknown>,
): Promise<string> {
  const explicit = readExplicitArchivedInboxPointer(rec);
  if (explicit !== "") {
    return explicit;
  }

  const candidates = collectInboxSourceCandidates(rec);
  const taskId =
    typeof rec["task_id"] === "string"
      ? rec["task_id"]
      : typeof rec["taskId"] === "string"
        ? rec["taskId"]
        : undefined;

  for (const rel of candidates) {
    if (rel.startsWith(".pan/archive/inbox/") && existsSync(resolveRepoPath(repoRoot, rel))) {
      return rel;
    }
  }
  for (const rel of candidates) {
    if (existsSync(resolveRepoPath(repoRoot, rel))) {
      return rel;
    }
  }
  for (const rel of candidates) {
    if (!rel.startsWith("lib/inbox/in/")) continue;
    const resolved = await resolveInboxInPathToArchive(repoRoot, rel, taskId);
    if (resolved !== null) {
      return resolved;
    }
  }
  for (const rel of candidates) {
    if (rel.startsWith(".pan/archive/inbox/")) {
      return rel;
    }
  }
  return "";
}

/** Backfills feature index.json with the post-close archived inbox path. */
export async function patchFeatureIndexArchivedInbox(
  repoRoot: string,
  featureId: string,
  archivedInboxRel: string,
  priorInboxSourceRel: string,
): Promise<void> {
  const indexAbs = resolveFeatureIndexAbs(repoRoot, featureId);
  if (!existsSync(indexAbs)) {
    return;
  }
  const parsed = JSON.parse(await readFile(indexAbs, "utf8")) as Record<string, unknown>;
  delete parsed["archived_inbox_source"];
  parsed["source_inbox_item"] = archivedInboxRel;
  parsed["source_inbox_item_prior"] = priorInboxSourceRel;

  const intake = parsed["intake"];
  if (intake && typeof intake === "object") {
    const intakeRec = intake as Record<string, unknown>;
    if (typeof intakeRec["source_inbox_item"] === "string") {
      intakeRec["source_inbox_item"] = archivedInboxRel;
    }
  }

  await writeFile(indexAbs, stringifyCliJson(repoRoot, parsed), "utf8");
}

/** Restores feature index.json active inbox paths after pan reopen. */
export async function patchFeatureIndexReopenedInbox(
  repoRoot: string,
  featureId: string,
  activeInboxRel: string,
): Promise<void> {
  const indexAbs = resolveFeatureIndexAbs(repoRoot, featureId);
  if (!existsSync(indexAbs)) {
    return;
  }
  const parsed = JSON.parse(await readFile(indexAbs, "utf8")) as Record<string, unknown>;
  delete parsed["archived_inbox_source"];

  parsed["source_inbox_item"] = activeInboxRel;
  delete parsed["source_inbox_item_prior"];

  const intake = parsed["intake"];
  if (intake && typeof intake === "object") {
    const intakeRec = intake as Record<string, unknown>;
    if (typeof intakeRec["source_inbox_item"] === "string") {
      intakeRec["source_inbox_item"] = activeInboxRel;
    }
  }

  await writeFile(indexAbs, stringifyCliJson(repoRoot, parsed), "utf8");
}

function restoreActiveFeaturePointerForReopenedInbox(sectionInner: string, activeInboxRel: string): string {
  const active = normalizeInboxRel(activeInboxRel);
  const pointers = extractActiveFeatureInboxPointers(sectionInner);
  if (pointers.includes(active)) {
    return sectionInner;
  }
  const trimmed = sectionInner.trim();
  if (trimmed.length === 0 || trimmed.includes("(none)")) {
    return `\n- \`${active}\`\n`;
  }
  return `${sectionInner.trimEnd()}\n- \`${active}\`\n`;
}

/** Restores Active Feature pointer after pan reopen when the inbox source was unarchived. */
export async function applyActiveMemoryRefreshOnReopen(
  repoRoot: string,
  input: { activeInboxSourceRel: string; clock?: () => Date },
): Promise<{ path: string; activeFeatureRestored: boolean }> {
  const repoRootAbs = path.resolve(repoRoot);
  const currentAbs = resolveRepoPath(repoRootAbs, CURRENT_MD_REL);
  if (!existsSync(currentAbs)) {
    return { path: CURRENT_MD_REL, activeFeatureRestored: false };
  }
  const raw = await readFile(currentAbs, "utf8");
  const now = input.clock?.() ?? new Date();
  const activeObserved = getSectionInner(raw, "Active Feature");
  const restoredInner = restoreActiveFeaturePointerForReopenedInbox(activeObserved, input.activeInboxSourceRel);
  const restored = restoredInner !== activeObserved;
  const assembled = await assembleRefreshedCurrentMd(
    repoRootAbs,
    raw,
    now,
    restored ? restoredInner : undefined,
  );
  if (restored) {
    await writeFile(currentAbs, assembled, "utf8");
  }
  return { path: CURRENT_MD_REL, activeFeatureRestored: restored };
}

export async function deriveShippedMarkdownTable(repoRoot: string): Promise<string> {
  const featuresRoot = resolveProjectPath(repoRoot, "lib", "memory", "features");
  const indexPaths: Array<{ abs: string; dirName: string }> = [];
  try {
    const categories = (await readdir(featuresRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
    for (const category of categories) {
      const categoryRoot = path.join(featuresRoot, category);
      const legacyIndex = path.join(categoryRoot, "index.json");
      if (existsSync(legacyIndex)) {
        indexPaths.push({ abs: legacyIndex, dirName: category });
        continue;
      }
      const featureDirs = (await readdir(categoryRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
      for (const dirName of featureDirs) {
        const abs = path.join(categoryRoot, dirName, "index.json");
        if (existsSync(abs)) indexPaths.push({ abs, dirName });
      }
    }
  } catch {
    return "\n(No indexed features discovered.)\n";
  }

  const rows: IndexedShipRow[] = [];

  for (const { abs: indexPath, dirName } of indexPaths) {
    const rawText = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const statusRaw = parsed["status"];
    const isIndexed = statusRaw === "indexed";

    const featureIdRoot = parsed["feature_id"];
    const featureIdCamel = parsed["featureId"];
    const featureId =
      typeof featureIdRoot === "string"
        ? featureIdRoot
        : typeof featureIdCamel === "string"
          ? featureIdCamel
          : dirName;
    const completedAtMs = parseShippedAtMs(parsed);

    const deliveryRel = readDeliveryReportPath(parsed);
    const outboxArtifact = readOutboxStagingPath(parsed);
    const archivedSrc = await resolveArchivedInboxPointer(repoRoot, parsed);

    let row = "";

    const deliveryPathStyled = deliveryRel !== "" ? `\`${truncateCell(deliveryRel, 120)}\`` : "`—`";
    const outboxStyled = outboxArtifact !== "" ? `\`${truncateCell(outboxArtifact, 120)}\`` : "`—`";
    const archivedStyled = archivedSrc !== "" ? `\`${truncateCell(archivedSrc, 120)}\`` : "`—`";

    if (isIndexed) {
      row = `| \`${featureId}\` | [indexed] (${completedAtMs !== null ? `\`${new Date(completedAtMs).toISOString()}\`` : "`—`"}) | ${deliveryPathStyled} | ${outboxStyled} | ${archivedStyled} |`;
    }

    rows.push({
      featureId,
      completedAtMs: completedAtMs ?? 0,
      row,
    });
  }

  const indexedRows = rows.filter((r) => r.row !== "");
  indexedRows.sort((a, b) => {
    if (b.completedAtMs !== a.completedAtMs) return b.completedAtMs - a.completedAtMs;
    return a.featureId.localeCompare(b.featureId);
  });
  const cappedRows = indexedRows.slice(0, SHIPPED_LEDGER_ROW_CAP);

  let table =
    "| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n";
  if (cappedRows.length === 0) {
    table += "| `—` | `—` | `—` | `—` | `—` |\n";
  } else {
    for (const r of cappedRows) {
      table += `${r.row}\n`;
    }
  }
  return `\n${table}`;
}

function buildManagedOperatorSlice(nowUtcIso: string): string {
  return [
    OPS_NOTES_AUTO_START,
    "",
    `- Active-memory refreshed (UTC): \`${nowUtcIso}\``,
    "",
    OPS_NOTES_AUTO_END,
    "",
  ].join("\n");
}

function replaceOperatorNotesAutomation(fullSection: string, managedSlice: string): string {
  const startIdx = fullSection.indexOf(OPS_NOTES_AUTO_START);
  const endIdx = fullSection.indexOf(OPS_NOTES_AUTO_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      fullSection.slice(0, startIdx) +
      managedSlice.trimEnd() +
      "\n" +
      fullSection.slice(endIdx + OPS_NOTES_AUTO_END.length)
    );
  }
  return `\n${managedSlice}\n${fullSection.replace(/^\s*\n/u, "")}`;
}

function getSectionInner(source: string, headingTitle: string): string {
  const header = `## ${headingTitle}\n`;
  const idx = source.indexOf(header);
  if (idx === -1) {
    throw new Error(`Heading "## ${headingTitle}" is missing from current.md`);
  }
  const innerStart = idx + header.length;
  const tail = source.slice(innerStart);
  const relNext = tail.search(/\n## /u);
  const innerEnd = relNext === -1 ? source.length : innerStart + relNext;
  return source.slice(innerStart, innerEnd);
}

function replaceSectionInner(source: string, headingTitle: string, newInner: string): string {
  const header = `## ${headingTitle}\n`;
  const idx = source.indexOf(header);
  if (idx === -1) {
    throw new Error(`Heading "## ${headingTitle}" is missing from current.md`);
  }
  const innerStart = idx + header.length;
  const tail = source.slice(innerStart);
  const relNext = tail.search(/\n## /u);
  const innerEnd = relNext === -1 ? source.length : innerStart + relNext;
  return `${source.slice(0, innerStart)}${newInner}${source.slice(innerEnd)}`;
}

function normalizeSectionInner(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalizeManagedOperatorNotesAuto(inner: string): string {
  const startIdx = inner.indexOf(OPS_NOTES_AUTO_START);
  const endIdx = inner.indexOf(OPS_NOTES_AUTO_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const afterAuto = endIdx + OPS_NOTES_AUTO_END.length;
    return `${inner.slice(0, startIdx)}\n<pan:auto-managed-operator-notes />\n${inner.slice(afterAuto)}`;
  }
  return inner;
}

function operatorNotesSectionConflictFree(observed: string, rebuilt: string): boolean {
  return (
    normalizeSectionInner(canonicalizeManagedOperatorNotesAuto(observed)) ===
    normalizeSectionInner(canonicalizeManagedOperatorNotesAuto(rebuilt))
  );
}

async function computeActiveMemorySlices(repoRootAbs: string, now: Date): Promise<ActiveMemorySlices> {
  const iso = now.toISOString();
  const managedOperatorNotesSlice = buildManagedOperatorSlice(iso);
  const shippedFeaturesBody = await deriveShippedMarkdownTable(repoRootAbs);
  return { shippedFeaturesBody, managedOperatorNotesSlice };
}

function diffSlices(label: string, observed: string, computed: string): string {
  if (normalizeSectionInner(observed) === normalizeSectionInner(computed)) return "";
  return `Section ${quoteJsonString(label)}:\n--- observed\n${observed}\n+++ computed\n${computed}\n`;
}

async function assembleRefreshedCurrentMd(
  repoRootAbs: string,
  raw: string,
  now: Date,
  activeFeatureInner?: string,
): Promise<string> {
  const notesObserved = getSectionInner(raw, "Operator notes");
  const slices = await computeActiveMemorySlices(repoRootAbs, now);
  const rebuiltNotesSection = replaceOperatorNotesAutomation(notesObserved, slices.managedOperatorNotesSlice);
  let assembled = raw;
  if (activeFeatureInner !== undefined) {
    assembled = replaceSectionInner(assembled, "Active Feature", activeFeatureInner);
  }
  assembled = replaceSectionInner(assembled, "Most recent shipped Features", slices.shippedFeaturesBody);
  assembled = replaceSectionInner(assembled, "Operator notes", rebuiltNotesSection);
  return `${assembled.trimEnd()}\n`;
}

/** Refreshes shipped rows and operator-note stamp; clears Active Feature when it matched the archived inbox source. */
export async function applyActiveMemoryRefreshOnArtifactClosure(
  repoRoot: string,
  input: { archivedInboxSourceRel: string; clock?: () => Date },
): Promise<ActiveMemoryArtifactClosureRefreshResult> {
  const repoRootAbs = path.resolve(repoRoot);
  const currentAbs = resolveRepoPath(repoRootAbs, CURRENT_MD_REL);
  if (!existsSync(currentAbs)) {
    throw new Error(`Missing active memory file ${CURRENT_MD_REL}`);
  }
  const raw = await readFile(currentAbs, "utf8");
  const now = input.clock?.() ?? new Date();
  const activeObserved = getSectionInner(raw, "Active Feature");
  const { inner: activeInner, cleared } = clearActiveFeaturePointerForArchivedInbox(
    activeObserved,
    input.archivedInboxSourceRel,
  );
  const assembled = await assembleRefreshedCurrentMd(
    repoRootAbs,
    raw,
    now,
    cleared ? activeInner : undefined,
  );
  await writeFile(currentAbs, assembled, "utf8");
  return { path: CURRENT_MD_REL, activeFeatureCleared: cleared };
}

export async function rewriteActiveMemoryFile(opts: {
  readonly repoRoot: string;
  readonly dryRun: boolean;
  readonly acceptDerived?: boolean;
  readonly writeOut: (c: string) => void;
  readonly writeErr?: (c: string) => void;
  readonly clock: () => Date;
}): Promise<number> {
  const repoRootAbs = path.resolve(opts.repoRoot);
  const currentAbs = resolveRepoPath(repoRootAbs, CURRENT_MD_REL);
  if (!existsSync(currentAbs)) {
    throw new Error(`Missing active memory file ${CURRENT_MD_REL}`);
  }
  const raw = await readFile(currentAbs, "utf8");
  const now = opts.clock();

  const activeObserved = getSectionInner(raw, "Active Feature");
  const shippedObserved = getSectionInner(raw, "Most recent shipped Features");
  const notesObserved = getSectionInner(raw, "Operator notes");

  const staleActiveMsg = validateActiveFeatureInboxPointers(repoRootAbs, activeObserved);
  if (staleActiveMsg !== null) {
    opts.writeErr?.(`${staleActiveMsg}\n`);
    return PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
  }

  const slices = await computeActiveMemorySlices(repoRootAbs, now);
  const rebuiltNotesSection = replaceOperatorNotesAutomation(notesObserved, slices.managedOperatorNotesSlice);

  const diffChunks: string[] = [];
  const shippedChunk = diffSlices("## Most recent shipped Features", shippedObserved, slices.shippedFeaturesBody);
  if (shippedChunk) diffChunks.push(shippedChunk);
  const notesChunk = operatorNotesSectionConflictFree(notesObserved, rebuiltNotesSection)
    ? ""
    : diffSlices("## Operator notes", notesObserved, rebuiltNotesSection);
  if (notesChunk) diffChunks.push(notesChunk);

  const combinedDiff = diffChunks.join("\n");
  if (combinedDiff.length > 0) {
    opts.writeOut(`${combinedDiff}\n`);
  }

  if (opts.dryRun) {
    if (diffChunks.length > 0) {
      opts.writeErr?.(
        "Active-memory refresh dry-run: labeled sections diverge from derived values; inspect stdout diff.\n",
      );
      return PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
    }
    return 0;
  }

  const shippedOnlyConflict =
    diffChunks.length === 1 && shippedChunk.length > 0 && notesChunk.length === 0;

  if (diffChunks.length > 0 && !(opts.acceptDerived === true && shippedOnlyConflict)) {
    opts.writeErr?.(
      "Active-memory refresh halted: resolve conflicts, pass --dry-run to preview, or pass --accept-derived when only shipped-feature rows drift from index.json.\n",
    );
    return PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
  }

  const assembled = await assembleRefreshedCurrentMd(repoRootAbs, raw, now);
  await writeFile(currentAbs, assembled, "utf8");
  return 0;
}
