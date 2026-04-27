/**
 * @packageDocumentation
 * Shared types and version metadata for Tesseract primitives.
 * Dependency policy: no other `@tesseract/*` packages.
 */

export const TESSERACT_CORE_VERSION = "0.0.0" as const;

export type { ContentHash, FeatureId, TaskId } from "./branded.js";
export { asContentHash, asFeatureId, asTaskId } from "./branded.js";
