/**
 * @packageDocumentation
 * YAML pipeline definitions, LangGraph StateGraph compilation, and in-process execution.
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_PIPELINE_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_PIPELINE_STUB = "pipeline" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function pipelineStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type {
  CompiledPipeline,
  PipelineCircuitBreaker,
  PipelineDefinition,
  PipelineExecutionContext,
  PipelineGraphEdge,
  PipelineGraphNode,
  PipelineStage,
} from "./types.js";
export { compilePipeline, INTERVENTION_NODE_ID, serializePipelineStages } from "./compile.js";
export type { CompilePipelineOptions } from "./compile.js";
export type { ExecutePipelineOptions } from "./execute.js";
export { executePipeline } from "./execute.js";
export { loadPipelineYaml } from "./load-yaml.js";
