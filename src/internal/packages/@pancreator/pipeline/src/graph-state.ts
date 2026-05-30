import { Annotation } from "@langchain/langgraph";

import type { PipelineExecutionContext } from "./types.js";

export const PipelineGraphAnnotation = Annotation.Root({
  context: Annotation<unknown>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  execCtx: Annotation<PipelineExecutionContext>({
    reducer: (_left, right) => right,
    default: () => ({
      currentStageId: "",
      iteration: 0,
      halted: false,
    }),
  }),
});
