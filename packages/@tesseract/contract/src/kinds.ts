/**
 * Registry of MVP contract kinds. New kinds need a promotion ADR per handbook `contract-format`.
 */
export const CONTRACT_KINDS_MVP = ["rego", "llm-judge"] as const;

/**
 * A closed-core kind label from the MVP allowlist in `/memory/handbook/contract-format.md` §2.
 */
export type ContractKind = (typeof CONTRACT_KINDS_MVP)[number];

/**
 * A gate severity. `block` maps to pipeline failure; `warn` and `info` are non-fatal in MVP defaults.
 */
export type ContractSeverity = "block" | "warn" | "info";
