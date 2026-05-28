/**
 * @packageDocumentation
 * String-level helpers for Layer 1 weasel detection, aligned to `/src/memory/handbook/contract-style.md` Rule 1.6.
 */
export { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export { LAYER1_WEASEL_BANLIST } from "./banlist.js";
export { findLayer1WeaselHits } from "./scan.js";
export type { WeaselHit } from "./scan.js";

export const DAEDALINE_CONTRACT_STYLE_STUB = "contract-style" as const;

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

/**
 * Returns the `daedaline` monorepo version string from `@daedaline/core`.
 */
export function contractStyleStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
