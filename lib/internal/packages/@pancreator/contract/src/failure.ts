import type { ContentHash } from "@pancreator/core";

import type { ContractClause } from "./wrapper.js";

/**
 * Record returned when a contract gate fails, aligned with the failure shape in `/lib/memory/handbook/contract-format.md`.
 */
export type ContractFailure = {
  contractId: string;
  message: string;
  clause: ContractClause;
  evidence?: Record<string, unknown>;
  /**
   * Optional machine-readable digest for de-duplication in the run log.
   */
  evidenceContentHash?: ContentHash;
};
