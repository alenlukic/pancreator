/**
 * @packageDocumentation
 * Kind-agnostic contract wrapper types and structural validation for the Phase 3 spine.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export { PANCREATOR_CORE_VERSION };

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

export const PANCREATOR_CONTRACT_STUB = "contract" as const;

/**
 * Returns the `pancreator` monorepo version string from `@pancreator/core`.
 */
export function contractStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
