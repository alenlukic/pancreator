import { compilePipeline, type CompilePipelineOptions } from "./compile.js";
import type { PipelineDefinition, PipelineExecutionContext, PipelineStage } from "./types.js";
import type { CompiledPipeline } from "./types.js";

export function slicePipelineDefinitionForStage(
  definition: PipelineDefinition,
  stageId: string,
): PipelineDefinition {
  const stage = definition.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw new Error(`Pipeline "${definition.id}" has no stage "${stageId}".`);
  }
  return {
    ...definition,
    stages: [stage],
  };
}

export interface ExecutePipelineOptions {
  /** Pre-compiled graph; when omitted, {@link compilePipeline} runs on `definition`. */
  compiled?: CompiledPipeline;
  /** When true, intervention side-channel is invoked after each stage. */
  enableInterventionChannel?: boolean;
}

/**
 * Executes a compiled LangGraph pipeline: invokes the compiled `StateGraph` with
 * caller-supplied stage handlers in `configurable.stepFn`.
 */
export async function executePipeline<TContext>(
  definition: PipelineDefinition,
  initialContext: TContext,
  stepFn: (
    stage: PipelineStage,
    context: TContext,
    exec: PipelineExecutionContext,
  ) => TContext | Promise<TContext>,
  options: ExecutePipelineOptions = {},
): Promise<TContext> {
  const compiled = options.compiled ?? compilePipeline(definition);
  const initialExecCtx: PipelineExecutionContext = {
    currentStageId: compiled.entryNodeId,
    iteration: 0,
    halted: false,
  };

  const runnable = compiled.graph.compile();
  const finalState = await runnable.invoke(
    {
      context: initialContext,
      execCtx: initialExecCtx,
    },
    {
      configurable: {
        stepFn: stepFn as (
          stage: PipelineStage,
          context: unknown,
          exec: PipelineExecutionContext,
        ) => unknown,
        definition,
        enableInterventionChannel: options.enableInterventionChannel ?? false,
      },
    },
  );

  return finalState.context as TContext;
}

/**
 * Executes exactly one stage through the compiled LangGraph slice for `stageId`.
 */
export async function executeStageSlice<TContext>(
  definition: PipelineDefinition,
  stageId: string,
  initialContext: TContext,
  stepFn: (
    stage: PipelineStage,
    context: TContext,
    exec: PipelineExecutionContext,
  ) => TContext | Promise<TContext>,
  options: ExecutePipelineOptions & CompilePipelineOptions = {},
): Promise<TContext> {
  const sliced = slicePipelineDefinitionForStage(definition, stageId);
  let compiled = options.compiled;
  if (compiled !== undefined && compiled.entryNodeId !== stageId) {
    compiled = undefined;
  }
  compiled =
    compiled ??
    compilePipeline(sliced, {
      knownPersonas: options.knownPersonas,
      worktreePoolUnavailable: options.worktreePoolUnavailable,
    });
  return executePipeline(sliced, initialContext, stepFn, { ...options, compiled });
}
