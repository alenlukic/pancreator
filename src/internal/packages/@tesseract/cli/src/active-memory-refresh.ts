import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Exit code when computed active-memory slices disagree with observed content. */
export const TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE = 126;

const OPS_NOTES_AUTO_START = "<!-- tess:active-memory:operator-notes:auto -->";
const OPS_NOTES_AUTO_END = "<!-- /tess:active-memory:operator-notes:auto -->";

const CURRENT_MD_REL = "src/memory/active/current.md";

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
  for (const match of sectionInner.matchAll(/`(src\/inbox\/in\/[^`\s]+)`/g)) {
    out.push(match[1]!);
  }
  return out;
}

function normalizeInboxRel(rel: string): string {
  return rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

export function validateActiveFeatureInboxPointers(repoRoot: string, sectionInner: string): string | null {
  for (const rel of extractActiveFeatureInboxPointers(sectionInner)) {
    if (!existsSync(path.join(repoRoot, rel))) {
      return (
        `Active Feature pointer ${JSON.stringify(rel)} is missing under src/inbox/in/; ` +
        "set or clear the pointer manually in src/memory/active/current.md " +
        "(tess close-artifacts clears matching pointers automatically during artifact closure)."
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
  if (index && typeof index === "object") {
    const idx = index as Record<string, unknown>;
    candidate = idx["completed_at"];
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    candidate =
      handoff && typeof handoff === "object"
        ? (handoff as Record<string, unknown>)["completed_at"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    const ship = rec["shipped"];
    candidate =
      ship && typeof ship === "object"
        ? (ship as Record<string, unknown>)["shipped_at_utc"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
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
  return raw !== undefined && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function readDeliveryReportPath(rec: Record<string, unknown>): string {
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
  return "";
}

function readOutboxStagingPath(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["staged_to_inbox_out"] === "string") {
    return top["staged_to_inbox_out"] as string;
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

function readArchivedInboxPointer(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["archived_inbox_source"] === "string") {
    return top["archived_inbox_source"] as string;
  }
  const ship = rec["shipped"];
  if (ship && typeof ship === "object" && typeof (ship as Record<string, unknown>)["archived_inbox_source"] === "string") {
    return (ship as Record<string, unknown>)["archived_inbox_source"] as string;
  }
  const notifier = rec["notifier"];
  if (
    notifier &&
    typeof notifier === "object" &&
    typeof (notifier as Record<string, unknown>)["inbox_source_archived_to"] === "string"
  ) {
    return (notifier as Record<string, unknown>)["inbox_source_archived_to"] as string;
  }
  return "";
}

async function deriveShippedMarkdownTable(repoRoot: string): Promise<string> {
  const featuresRoot = path.join(repoRoot, "src", "memory", "features");
  let dirs: string[] = [];
  try {
    dirs = (await readdir(featuresRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return "\n(No indexed features discovered.)\n";
  }

  const rows: IndexedShipRow[] = [];

  for (const dirName of dirs) {
    const indexPath = path.join(featuresRoot, dirName, "index.json");
    if (!existsSync(indexPath)) continue;
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
    const archivedSrc = readArchivedInboxPointer(parsed);

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

  let table =
    "| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n";
  if (indexedRows.length === 0) {
    table += "| `—` | `—` | `—` | `—` | `—` |\n";
  } else {
    for (const r of indexedRows) {
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
    return `${inner.slice(0, startIdx)}\n<tess:auto-managed-operator-notes />\n${inner.slice(afterAuto)}`;
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
  return `Section ${JSON.stringify(label)}:\n--- observed\n${observed}\n+++ computed\n${computed}\n`;
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
  return assembled;
}

/** Refreshes shipped rows and operator-note stamp; clears Active Feature when it matched the archived inbox source. */
export async function applyActiveMemoryRefreshOnArtifactClosure(
  repoRoot: string,
  input: { archivedInboxSourceRel: string; clock?: () => Date },
): Promise<ActiveMemoryArtifactClosureRefreshResult> {
  const repoRootAbs = path.resolve(repoRoot);
  const currentAbs = path.join(repoRootAbs, CURRENT_MD_REL);
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
  readonly writeOut: (c: string) => void;
  readonly writeErr?: (c: string) => void;
  readonly clock: () => Date;
}): Promise<number> {
  const repoRootAbs = path.resolve(opts.repoRoot);
  const currentAbs = path.join(repoRootAbs, CURRENT_MD_REL);
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
    return TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
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
      return TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
    }
    return 0;
  }

  if (diffChunks.length > 0) {
    opts.writeErr?.("Active-memory refresh halted: resolve conflicts or pass --dry-run to preview.\n");
    return TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
  }

  const assembled = await assembleRefreshedCurrentMd(repoRootAbs, raw, now);
  await writeFile(currentAbs, assembled, "utf8");
  return 0;
}
