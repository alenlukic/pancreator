import type { StateGraph } from "@langchain/langgraph";

import type { PipelineGraphAnnotation } from "./graph-state.js";

/**
 * @packageDocumentation
 * YAML pipeline definition and LangGraph StateGraph compilation for in-process execution.
 */

/** One node in the ordered execution list. */
export interface PipelineStage {
  /** Stable stage id (e.g. `plan`, `implement`). */
  id: string;
  /** Optional persona name for routing metadata. */
  persona?: string;
  /** Human label for timelines. */
  label?: string;
  /** Gate directive: stage runs only when expression is satisfied (stub: always true). */
  gate?: string;
  /** Loop directive: re-enter stage until condition (stub: single pass). */
  loop?: string;
}

export interface PipelineCircuitBreaker {
  max_iterations?: number;
  max_tokens?: number;
  max_tool_failures_consecutive?: number;
}

/**
 * Top-level pipeline document loaded from YAML under `lib/pipelines/`.
 */
export interface PipelineDefinition {
  id: string;
  version?: string;
  stages: PipelineStage[];
  circuit_breaker?: PipelineCircuitBreaker;
  /** Extension map for forwards-compatible fields. */
  metadata?: Record<string, unknown>;
}

export type PipelineGraphNodeKind = "stage" | "intervention";

export interface PipelineGraphNode {
  id: string;
  kind: PipelineGraphNodeKind;
  stage?: PipelineStage;
}

export interface PipelineGraphEdge {
  from: string;
  to: string;
  /** Edge kind for gate/loop/circuit-breaker routing metadata. */
  kind?: "next" | "gate" | "loop" | "circuit_breaker";
}

/**
 * Compiled graph: stage nodes plus a single intervention side-channel node.
 */
export interface CompiledPipeline {
  readonly definition: PipelineDefinition;
  /** LangGraph `StateGraph` compiled from pipeline YAML (call `.compile()` to invoke). */
  readonly graph: StateGraph<typeof PipelineGraphAnnotation>;
  readonly stageIds: readonly string[];
  readonly nodes: readonly PipelineGraphNode[];
  readonly edges: readonly PipelineGraphEdge[];
  readonly interventionNodeId: string;
  readonly entryNodeId: string;
  readonly exitNodeId: string;
}

export interface PipelineExecutionContext {
  /** Current stage id after each step. */
  currentStageId: string;
  iteration: number;
  halted: boolean;
  haltReason?: string;
  /** Last stage that completed before intervention routing. */
  lastCompletedStageId?: string;
}

/** LangGraph channel state for pipeline execution. */
export interface PipelineGraphState {
  context: unknown;
  execCtx: PipelineExecutionContext;
}
