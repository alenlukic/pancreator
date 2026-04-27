import { asContentHash } from "@tesseract/core";
import { CONTRACT_KINDS_MVP, type ContractKind, type ContractSeverity } from "./kinds.js";
import type { AppliesTo, ContractClause, Reference } from "./wrapper.js";

const KINDS = new Set<string>(CONTRACT_KINDS_MVP);

/**
 * Type guard for `kind` in the MVP list.
 */
export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === "string" && KINDS.has(value);
}

/**
 * Type guard for `severity`.
 */
export function isContractSeverity(value: unknown): value is ContractSeverity {
  return value === "block" || value === "warn" || value === "info";
}

function isContentHashString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Returns true when `value` is a `Reference` object with valid `kind` and fields.
 */
export function isReference(value: unknown): value is Reference {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (o.kind === "lines") {
    if (typeof o.path !== "string" || typeof o.note !== "string") {
      return false;
    }
    if (!Array.isArray(o.range) || o.range.length !== 2) {
      return false;
    }
    const [a, b] = o.range;
    if (typeof a !== "number" || typeof b !== "number") {
      return false;
    }
    if (!isContentHashString(o.contentHash)) {
      return false;
    }
    void asContentHash(o.contentHash);
    return true;
  }
  if (o.kind === "symbol") {
    if (typeof o.path !== "string" || typeof o.symbol !== "string" || typeof o.note !== "string") {
      return false;
    }
    if (!isContentHashString(o.contentHash)) {
      return false;
    }
    void asContentHash(o.contentHash);
    return true;
  }
  return false;
}

/**
 * Returns true when `value` is a valid `applies_to` for the Phase 3 spine.
 */
export function isAppliesTo(value: unknown): value is AppliesTo {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (o.kind === "file-path" && typeof o.glob === "string") {
    return true;
  }
  if (
    o.kind === "artifact-symbol" &&
    typeof o.path === "string" &&
    typeof o.symbol === "string" &&
    isContentHashString(o.contentHash)
  ) {
    void asContentHash(o.contentHash);
    return true;
  }
  return false;
}

/**
 * Returns true when `value` is a `ContractClause` the Phase 3 spine can dispatch.
 * This check is structural, not a full OPA or Zod pass.
 */
export function isContractClause(value: unknown): value is ContractClause {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length < 1) {
    return false;
  }
  if (!isContractKind(o.kind) || !isContractSeverity(o.severity)) {
    return false;
  }
  if (!isAppliesTo(o.applies_to)) {
    return false;
  }
  if (typeof o.owner !== "string" || typeof o.description !== "string") {
    return false;
  }
  if (!Array.isArray(o.references) || o.references.length < 1) {
    return false;
  }
  for (const ref of o.references) {
    if (!isReference(ref)) {
      return false;
    }
  }
  if (o.spec !== undefined && typeof o.spec !== "string") {
    return false;
  }
  if (o.module !== undefined && typeof o.module !== "string") {
    return false;
  }
  if (o.runtime === null || typeof o.runtime !== "object") {
    return false;
  }
  if (o.metadata === null || typeof o.metadata !== "object") {
    return false;
  }
  for (const v of Object.values(o.metadata as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      return false;
    }
  }
  return true;
}
