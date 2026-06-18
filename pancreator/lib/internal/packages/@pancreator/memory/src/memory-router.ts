import { readFile } from "node:fs/promises";

const ROUTE_HEADER = "| Intent or question |";

export type RouteHit = {
  readonly intent: string;
  readonly primaryPaths: string[];
  readonly secondaryPaths: string[];
  readonly notes: string;
};

/**
 * Splits a handbook table cell on comma+whitespace, then trims backticks and
 * inline Markdown path forms.
 */
export function parseDocList(cell: string): string[] {
  const trimmed = cell.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/,\s+/)
    .map((p) => p.replace(/^[`'"\s]+|[`'"\s]+$/g, ""))
    .map((p) => p.replace(/^\[([^\]]+)\]\([^)]+\)$/, "$1"))
    .filter((p) => p.length > 0);
}

/**
 * Parses the routing table in `/lib/memory/handbook/index.md` (glossary: MemoryRouter).
 */
export function parseHandbookIndexTable(markdown: string): RouteHit[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(ROUTE_HEADER));
  if (start === -1) {
    return [];
  }
  const out: RouteHit[] = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line?.trim() || !line.trim().startsWith("|")) {
      if (out.length > 0) {
        break;
      }
      continue;
    }
    if (/^\|\s*[-:]+\s*\|/.test(line)) {
      continue;
    }
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));
    if (cells.length < 4) {
      continue;
    }
    const [intent, primary, secondary, notes] = cells;
    out.push({
      intent,
      primaryPaths: parseDocList(primary),
      secondaryPaths: parseDocList(secondary),
      notes,
    });
  }
  return out;
}

/**
 * The system SHALL read `/lib/memory/handbook/index.md` and return top matches for a
 * free-text query (glossary: MemoryRouter).
 */
export class MemoryRouter {
  private readonly hits: RouteHit[];

  constructor(indexMarkdown: string) {
    this.hits = parseHandbookIndexTable(indexMarkdown);
  }

  static async fromIndexFile(absolutePath: string): Promise<MemoryRouter> {
    const md = await readFile(absolutePath, "utf8");
    return new MemoryRouter(md);
  }

  /**
   * Returns the best-ranking route rows for a user intent string.
   */
  routeIntent(query: string, options?: { limit?: number }): RouteHit[] {
    const q = query.trim().toLowerCase();
    const limit = options?.limit ?? 5;
    if (!q) {
      return this.hits.slice(0, limit);
    }
    const scored = this.hits
      .map((h) => {
        const t = h.intent.toLowerCase();
        let score = 0;
        if (t.includes(q)) {
          score += 100;
        }
        for (const word of q.split(/\s+/).filter((w) => w.length > 2)) {
          if (t.includes(word)) {
            score += 10;
          }
        }
        return { h, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const list = scored.length > 0 ? scored : this.hits.map((h) => ({ h, score: 0 }));
    return list.slice(0, limit).map((x) => x.h);
  }
}
