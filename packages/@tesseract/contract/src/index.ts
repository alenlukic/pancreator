/**
 * @packageDocumentation
 * Kind-agnostic contract wrapper types and structural validation for the Phase 3 spine.
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export { TESSERACT_CORE_VERSION };

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

export const TESSERACT_CONTRACT_STUB = "contract" as const;

/**
 * Returns the `tesseract` monorepo version string from `@tesseract/core`.
 */
export function contractStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
