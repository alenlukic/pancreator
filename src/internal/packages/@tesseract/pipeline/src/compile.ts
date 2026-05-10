import type { CompiledPipeline, PipelineDefinition } from "./types.js";

/**
 * Compiles a pipeline definition into an ordered stage list (in-process stub; no external graph runtime).
 */
export function compilePipeline(definition: PipelineDefinition): CompiledPipeline {
  if (!definition.stages?.length) {
    throw new Error("PipelineDefinition.stages MUST contain at least one stage.");
  }
  const stageIds = definition.stages.map((s) => s.id);
  const seen = new Set<string>();
  for (const id of stageIds) {
    if (seen.has(id)) {
      throw new Error(`Duplicate pipeline stage id "${id}".`);
    }
    seen.add(id);
  }
  return {
    definition,
    stageIds,
  };
}
