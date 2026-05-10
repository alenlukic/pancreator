/**
 * @packageDocumentation
 * String-level helpers for Layer 1 weasel detection, aligned to `/src/memory/handbook/contract-style.md` Rule 1.6.
 */
export { TESSERACT_CORE_VERSION } from "@tesseract/core";

export { LAYER1_WEASEL_BANLIST } from "./banlist.js";
export { findLayer1WeaselHits } from "./scan.js";
export type { WeaselHit } from "./scan.js";

export const TESSERACT_CONTRACT_STYLE_STUB = "contract-style" as const;

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * Returns the `tesseract` monorepo version string from `@tesseract/core`.
 */
export function contractStyleStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
