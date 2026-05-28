/**
 * @packageDocumentation
 * Shared types and version metadata for Daedaline primitives.
 * Dependency policy: no other `@daedaline/*` packages.
 */

export const DAEDALINE_CORE_VERSION = "0.0.0" as const;

export type { ContentHash, FeatureId, TaskId } from "./branded.js";
export { asContentHash, asFeatureId, asTaskId } from "./branded.js";
