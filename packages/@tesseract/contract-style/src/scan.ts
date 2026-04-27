import { LAYER1_WEASEL_BANLIST } from "./banlist.js";

/**
 * A hit against the Layer 1 weasel list for a non-empty prose span.
 */
export type WeaselHit = {
  start: number;
  end: number;
  phrase: string;
};

/**
 * Returns non-overlapping substring hits for the Layer 1 weasel list, lowest index first.
 * This is a string-level helper; full Layer 1 lint is tree-sitter based in the handbook.
 */
export function findLayer1WeaselHits(text: string): WeaselHit[] {
  if (text.length < 1) {
    return [];
  }
  const lower = text.toLowerCase();
  const hits: WeaselHit[] = [];
  for (const phrase of LAYER1_WEASEL_BANLIST) {
    const p = phrase.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(p, from);
      if (i < 0) {
        break;
      }
      hits.push({ start: i, end: i + p.length, phrase });
      from = i + p.length;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}
