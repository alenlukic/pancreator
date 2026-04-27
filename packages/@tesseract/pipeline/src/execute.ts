import type { PipelineDefinition, PipelineStage } from "./types.js";

/**
 * Walks `definition.stages` in order and threads `context` through `stepFn`.
 */
export async function executePipeline<TContext>(
  definition: PipelineDefinition,
  initialContext: TContext,
  stepFn: (stage: PipelineStage, context: TContext) => TContext | Promise<TContext>,
): Promise<TContext> {
  if (!definition.stages?.length) {
    throw new Error("PipelineDefinition.stages MUST contain at least one stage.");
  }
  let ctx = initialContext;
  for (const stage of definition.stages) {
    ctx = await stepFn(stage, ctx);
  }
  return ctx;
}
