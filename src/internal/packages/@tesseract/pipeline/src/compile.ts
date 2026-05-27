import { END, START, StateGraph } from "@langchain/langgraph";

import { PipelineGraphAnnotation } from "./graph-state.js";
import type {
  CompiledPipeline,
  PipelineDefinition,
  PipelineGraphEdge,
  PipelineGraphNode,
  PipelineStage,
} from "./types.js";

export const INTERVENTION_NODE_ID = "__intervention__" as const;

export interface CompilePipelineOptions {
  /** Known persona ids for validation; unknown personas fail compilation. */
  knownPersonas?: ReadonlySet<string>;
  /** When true, `worktree: required` in metadata fails compilation. */
  worktreePoolUnavailable?: boolean;
}

type PipelineConfigurable = {
  stepFn?: PipelineStageStepFn;
  definition?: PipelineDefinition;
  enableInterventionChannel?: boolean;
};

export type PipelineStageStepFn = (
  stage: PipelineStage,
  context: unknown,
  exec: import("./types.js").PipelineExecutionContext,
) => unknown | Promise<unknown>;

/**
 * Compiles a pipeline definition into a LangGraph `StateGraph` with stage nodes,
 * linear routing, and one intervention side-channel node.
 */
export function compilePipeline(
  definition: PipelineDefinition,
  options: CompilePipelineOptions = {},
): CompiledPipeline {
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

  validateDefinition(definition, options);

  const nodes: PipelineGraphNode[] = definition.stages.map((stage) => ({
    id: stage.id,
    kind: "stage",
    stage,
  }));
  nodes.push({ id: INTERVENTION_NODE_ID, kind: "intervention" });

  const edges: PipelineGraphEdge[] = [];
  for (let i = 0; i < definition.stages.length; i++) {
    const stage = definition.stages[i]!;
    const next = definition.stages[i + 1];
    edges.push({
      from: stage.id,
      to: next?.id ?? INTERVENTION_NODE_ID,
      kind: stage.gate ? "gate" : "next",
    });
    edges.push({ from: stage.id, to: INTERVENTION_NODE_ID, kind: "circuit_breaker" });
  }
  edges.push({ from: INTERVENTION_NODE_ID, to: stageIds[0]!, kind: "next" });

  const graph = new StateGraph(PipelineGraphAnnotation);

  for (const stage of definition.stages) {
    graph.addNode(stage.id, async (state, config) => runStageNode(stage, state, config));
  }

  graph.addNode(INTERVENTION_NODE_ID, async (state, config) => runInterventionNode(state, config));

  const firstStageId = stageIds[0]!;
  // Stage ids are YAML-driven; LangGraph node typing is widened for dynamic pipeline graphs.
  const dynamicGraph = graph as StateGraph<typeof PipelineGraphAnnotation> & {
    addEdge(source: typeof START | string, target: string): void;
    addConditionalEdges(
      source: string,
      path: (state: { execCtx: import("./types.js").PipelineExecutionContext }, config: { configurable?: PipelineConfigurable }) => string,
      pathMap?: Record<string, string>,
    ): void;
  };
  dynamicGraph.addEdge(START, firstStageId);

  for (let i = 0; i < definition.stages.length; i++) {
    const stage = definition.stages[i]!;
    const nextTarget = i + 1 < definition.stages.length ? definition.stages[i + 1]!.id : END;
    const routeMap: Record<string, string> = {
      [INTERVENTION_NODE_ID]: INTERVENTION_NODE_ID,
      [nextTarget]: nextTarget,
      [END]: END,
    };
    dynamicGraph.addConditionalEdges(
      stage.id,
      (state, config) => routeAfterStage(stage.id, state, config, nextTarget),
      routeMap,
    );
  }

  dynamicGraph.addConditionalEdges(
    INTERVENTION_NODE_ID,
    (state, config) => routeAfterIntervention(definition, state, config),
    buildInterventionRouteMap(definition),
  );

  const exitStage = definition.stages[definition.stages.length - 1]!;
  return {
    definition,
    graph,
    stageIds,
    nodes,
    edges,
    interventionNodeId: INTERVENTION_NODE_ID,
    entryNodeId: firstStageId,
    exitNodeId: exitStage.id,
  };
}

async function runStageNode(
  stage: PipelineStage,
  state: { context: unknown; execCtx: import("./types.js").PipelineExecutionContext },
  config: { configurable?: PipelineConfigurable },
) {
  const stepFn = config?.configurable?.stepFn;
  const pipelineDef = config?.configurable?.definition;
  if (!stepFn || !pipelineDef) {
    throw new Error("executePipeline MUST pass configurable.stepFn and configurable.definition.");
  }

  let execCtx = {
    ...state.execCtx,
    currentStageId: stage.id,
    iteration: state.execCtx.iteration + 1,
  };

  const maxIterations =
    pipelineDef.circuit_breaker?.max_iterations ?? pipelineDef.stages.length * 4;
  if (execCtx.iteration > maxIterations) {
    return {
      execCtx: {
        ...execCtx,
        halted: true,
        haltReason: "circuit_breaker.max_iterations",
      },
    };
  }

  if (execCtx.halted || !evaluateGate(stage.gate)) {
    return { execCtx };
  }

  const context = await stepFn(stage, state.context, execCtx);
  execCtx = { ...execCtx, lastCompletedStageId: stage.id };
  return { context, execCtx };
}

async function runInterventionNode(
  state: { context: unknown; execCtx: import("./types.js").PipelineExecutionContext },
  _config: { configurable?: PipelineConfigurable },
) {
  return {
    execCtx: {
      ...state.execCtx,
      currentStageId: INTERVENTION_NODE_ID,
    },
  };
}

function routeAfterStage(
  stageId: string,
  state: { execCtx: import("./types.js").PipelineExecutionContext },
  config: { configurable?: PipelineConfigurable },
  nextTarget: string,
): string {
  if (state.execCtx.halted) {
    return END;
  }
  if (config?.configurable?.enableInterventionChannel) {
    return INTERVENTION_NODE_ID;
  }
  return nextTarget;
}

function routeAfterIntervention(
  definition: PipelineDefinition,
  state: { execCtx: import("./types.js").PipelineExecutionContext },
  _config: { configurable?: PipelineConfigurable },
): string {
  if (state.execCtx.halted) {
    return END;
  }
  const lastId = state.execCtx.lastCompletedStageId;
  const idx = definition.stages.findIndex((s) => s.id === lastId);
  const next = idx >= 0 ? definition.stages[idx + 1] : undefined;
  if (!next) {
    return END;
  }
  return next.id;
}

function buildInterventionRouteMap(definition: PipelineDefinition): Record<string, string> {
  const map: Record<string, string> = { [END]: END };
  for (const stage of definition.stages) {
    map[stage.id] = stage.id;
  }
  return map;
}

function evaluateGate(gate: string | undefined): boolean {
  if (!gate) {
    return true;
  }
  return true;
}

function validateDefinition(definition: PipelineDefinition, options: CompilePipelineOptions): void {
  const known = options.knownPersonas;
  for (const stage of definition.stages) {
    if (stage.persona && known && !known.has(stage.persona)) {
      throw new Error(`Unknown persona "${stage.persona}" in stage "${stage.id}".`);
    }
  }
  const md = definition.metadata ?? {};
  if (md.worktree === "required" && options.worktreePoolUnavailable) {
    throw new Error(
      `Pipeline "${definition.id}" requires WorktreePool but WorktreePool is unavailable.`,
    );
  }
  const cb = definition.circuit_breaker;
  if (cb?.max_iterations !== undefined && cb.max_iterations < 1) {
    throw new Error("circuit_breaker.max_iterations MUST be >= 1 when set.");
  }
}

/** Serializes and re-parses stage list for identity tests. */
export function serializePipelineStages(stages: PipelineStage[]): PipelineStage[] {
  return JSON.parse(JSON.stringify(stages)) as PipelineStage[];
}
