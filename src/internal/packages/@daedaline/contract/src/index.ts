/**
 * @packageDocumentation
 * Kind-agnostic contract wrapper types and structural validation for the Phase 3 spine.
 */
import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export { DAEDALINE_CORE_VERSION };

export {
  CONTRACT_KINDS_MVP,
  type ContractKind,
  type ContractSeverity,
} from "./kinds.js";
export type {
  AppliesTo,
  AppliesToArtifactSymbol,
  AppliesToBase,
  AppliesToFilePath,
  AppliesToKind,
  ContractClause,
  Reference,
  ReferenceLines,
  ReferenceSymbol,
} from "./wrapper.js";
export type { ContractFailure } from "./failure.js";
export {
  isAppliesTo,
  isContractClause,
  isContractKind,
  isContractSeverity,
  isReference,
} from "./validate.js";

export const DAEDALINE_CONTRACT_STUB = "contract" as const;

/**
 * Returns the `daedaline` monorepo version string from `@daedaline/core`.
 */
export function contractStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
