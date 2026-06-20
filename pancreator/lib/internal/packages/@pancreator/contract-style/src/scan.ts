import { LAYER1_WEASEL_BANLIST } from "./banlist.js";

/**
 * A hit against the Layer 1 weasel list for a non-empty prose span.
 */
export type WeaselHit = {
  start: number;
  end: number;
  phrase: string;
};

export type MissingRfc2119Hit = {
  line: number;
  text: string;
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

const RFC_2119_KEYWORD =
  /\b(MUST(?: NOT)?|SHALL(?: NOT)?|SHOULD(?: NOT)?|MAY|OPTIONAL|RECOMMENDED|NOT RECOMMENDED|REQUIRED)\b/u;
const IMPERATIVE_HINT =
  /\b(resolve|load|apply|execute|emit|record|run|verify|use|delegate|route|treat|limit)\b/iu;

/**
 * Returns Required-context bullets that look imperative but omit RFC 2119 keywords.
 */
export function findRequiredContextMissingRfc2119(text: string): MissingRfc2119Hit[] {
  if (text.length < 1) {
    return [];
  }
  const lines = text.split(/\r?\n/u);
  const hits: MissingRfc2119Hit[] = [];
  let inRequiredContext = false;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (/^###\s+Required context\b/iu.test(line)) {
      inRequiredContext = true;
      continue;
    }
    if (inRequiredContext && /^###\s+/u.test(line)) {
      inRequiredContext = false;
    }
    if (!inRequiredContext || !line.startsWith("- ")) {
      continue;
    }
    if (!IMPERATIVE_HINT.test(line)) {
      continue;
    }
    if (RFC_2119_KEYWORD.test(line)) {
      continue;
    }
    hits.push({ line: idx + 1, text: line });
  }
  return hits;
}
