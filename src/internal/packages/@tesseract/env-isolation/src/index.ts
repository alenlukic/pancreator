/**
 * @packageDocumentation
 * File-backed port registry for environment isolation (exclusive PORT blocks per task).
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_ENV_ISOLATION_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_ENV_ISOLATION_STUB = "env-isolation" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function envIsolationStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export {
  InvalidPortRangeError,
  InvalidRegistryPathError,
  InvalidTaskIdError,
  PortRangeExhaustedError,
  PortRegistryCollisionError,
  PortRegistryError,
} from "./errors.js";
export {
  PortRegistryEnvIsolation,
  type PortRegistryEnvIsolationOptions,
} from "./port-registry-env-isolation.js";
export type { PortAllocation, PortRegistry } from "./types.js";
