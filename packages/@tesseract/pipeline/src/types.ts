/**
 * @packageDocumentation
 * Minimal YAML pipeline definition for in-process execution (no LangGraph runtime).
 */

/** One node in the ordered execution list. */
export interface PipelineStage {
  /** Stable stage id (e.g. `plan`, `implement`). */
  id: string;
  /** Optional persona name for routing metadata. */
  persona?: string;
  /** Human label for timelines. */
  label?: string;
}

/**
 * Top-level pipeline document loaded from YAML under `pipelines/`.
 */
export interface PipelineDefinition {
  id: string;
  version?: string;
  stages: PipelineStage[];
  /** Extension map for forwards-compatible fields. */
  metadata?: Record<string, unknown>;
}

/**
 * Compiled view: ordered stages only (structural surface for a future graph backend).
 */
export interface CompiledPipeline {
  readonly definition: PipelineDefinition;
  readonly stageIds: readonly string[];
}
