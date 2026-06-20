/**
 * @packageDocumentation
 * Shared types and version metadata for Pancreator primitives.
 * Dependency policy: no other `@pancreator/*` packages.
 */

export const PANCREATOR_CORE_VERSION = "0.0.0" as const;

export type { ContentHash, FeatureId, TaskId } from "./branded.js";
export { asContentHash, asFeatureId, asTaskId } from "./branded.js";
export {
  findHarnessRoot,
  projectRootAbs,
  readProjectRoot,
  readProjectRootFromYaml,
  resolveModelEscalationYamlPath,
  resolvePancreatorYamlPath,
  resolveProjectPath,
  resolveRepoPath,
} from "./project-root.js";
export {
  resolveDeliveryOperatingCard,
  resolveDeliveryOperatingCardRel,
} from "./delivery-operating-card.js";
export {
  abbreviateHashes,
  CANONICAL_JSON_INDENT_SPACES,
  deepCloneJson,
  formatCanonicalJson,
  MAX_INLINE_ARRAY_CHARS,
  quoteJsonString,
  resolveAbbrevLen,
  rewriteJsonText,
  stringifyCompactJson,
  stringifyRepoJson,
} from "./canonical-json.js";
export {
  humanizeHandbookWhy,
  personaOperatorWhy,
  PERSONA_OPERATOR_WHY,
} from "./operator-human-summary.js";
export {
  splitOperatorAgentSection,
  sliceOperatorAgentSection,
  stripOperatorAgentIndexFromFrontmatter,
  stripFrontmatterTitle,
  stripOperatorAgentJsonPrefix,
  parseOperatorAgentJsonText,
  wrapOperatorAgentMarkdown,
  wrapOperatorAgentYaml,
  wrapOperatorAgentJson,
  type OperatorAgentOperatorMeta,
} from "./operator-agent-section.js";
