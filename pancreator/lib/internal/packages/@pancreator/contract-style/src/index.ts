/**
 * @packageDocumentation
 * String-level helpers for Layer 1 weasel detection, aligned to `/lib/memory/handbook/contract-style.md` Rule 1.6.
 */
export { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export { LAYER1_WEASEL_BANLIST } from "./banlist.js";
export { findLayer1WeaselHits, findRequiredContextMissingRfc2119 } from "./scan.js";
export type { MissingRfc2119Hit, WeaselHit } from "./scan.js";

export const PANCREATOR_CONTRACT_STYLE_STUB = "contract-style" as const;

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

/**
 * Returns the `pancreator` monorepo version string from `@pancreator/core`.
 */
export function contractStyleStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
