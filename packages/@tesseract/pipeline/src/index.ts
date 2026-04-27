/**
 * @packageDocumentation
 * YAML pipeline definitions and an in-process ordered executor (no LangGraph dependency).
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_PIPELINE_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_PIPELINE_STUB = "pipeline" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function pipelineStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type { CompiledPipeline, PipelineDefinition, PipelineStage } from "./types.js";
export { compilePipeline } from "./compile.js";
export { executePipeline } from "./execute.js";
export { loadPipelineYaml } from "./load-yaml.js";
