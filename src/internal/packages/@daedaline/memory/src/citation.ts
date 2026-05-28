import { createHash } from "node:crypto";
import type { ContentHash } from "@daedaline/core";
import { asContentHash } from "@daedaline/core";

/**
 * Result of comparing a live file to a recorded dual-anchor content hash.
 */
export type CitationVerification = "valid" | "changed" | "gone" | "moved";

/**
 * Dual-anchor citation with a line range in the source file.
 */
export type LinesDualAnchor = {
  readonly kind: "lines";
  readonly path: string;
  readonly range: readonly [number, number];
  readonly contentHash: ContentHash;
};

/**
 * Dual-anchor citation with a named symbol in the source file.
 */
export type SymbolDualAnchor = {
  readonly kind: "symbol";
  readonly path: string;
  readonly symbol: string;
  readonly contentHash: ContentHash;
};

/**
 * Daedaline dual-anchor citation envelope (glossary: Dual-anchor citation).
 */
export type DualAnchorCitation = LinesDualAnchor | SymbolDualAnchor;

/**
 * The system SHALL compute the sha-256 hex digest of a UTF-8 string for
 * `contentHash` fields on dual-anchor citations.
 */
export function hashUtf8Content(body: string): ContentHash {
  const h = createHash("sha256").update(body, "utf8").digest("hex");
  return asContentHash(h);
}

/**
 * The system SHALL build a lines-scoped dual-anchor from a file path, a
 * 1-based inclusive line range, and the file body used for hashing.
 */
export function buildLinesDualAnchor(
  filePath: string,
  lineRange: readonly [number, number],
  fileBody: string,
): LinesDualAnchor {
  return {
    kind: "lines",
    path: filePath,
    range: [lineRange[0], lineRange[1]] as const,
    contentHash: hashUtf8Content(fileBody),
  };
}

/**
 * The system SHALL build a symbol-scoped dual-anchor from a file path, a
 * symbol name, and the file body used for hashing.
 */
export function buildSymbolDualAnchor(
  filePath: string,
  symbol: string,
  fileBody: string,
): SymbolDualAnchor {
  return {
    kind: "symbol",
    path: filePath,
    symbol,
    contentHash: hashUtf8Content(fileBody),
  };
}

/**
 * When the referenced path is readable, the system SHALL return `valid` or
 * `changed` by comparing `hashUtf8Content` to the citation content hash. When
 * the path is missing, the system SHALL return `gone`.
 */
export async function verifyDualAnchor(
  citation: DualAnchorCitation,
  readUtf8: (path: string) => Promise<string | undefined>,
): Promise<CitationVerification> {
  const body = await readUtf8(citation.path);
  if (body === undefined) {
    return "gone";
  }
  const live = hashUtf8Content(body);
  return live === citation.contentHash ? "valid" : "changed";
}
