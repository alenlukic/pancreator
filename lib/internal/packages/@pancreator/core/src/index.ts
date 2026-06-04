/**
 * @packageDocumentation
 * Shared types and version metadata for Pancreator primitives.
 * Dependency policy: no other `@pancreator/*` packages.
 */

export const PANCREATOR_CORE_VERSION = "0.0.0" as const;

export type { ContentHash, FeatureId, TaskId } from "./branded.js";
export { asContentHash, asFeatureId, asTaskId } from "./branded.js";
export {
  projectRootAbs,
  readProjectRoot,
  readProjectRootFromYaml,
  resolveModelEscalationYamlPath,
  resolvePancreatorYamlPath,
  resolveProjectPath,
  resolveRepoPath,
} from "./project-root.js";
