# Task List - @tesseract/pipeline

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.pipeline.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `tesseract.pipeline.readme_ergonomics` (manual review; LLM-judge contract deferred to CI).
- [x] T3: Implement `PipelineDefinition` / `PipelineStage`, `loadPipelineYaml`, ordered `executePipeline`, and `compilePipeline` stub (no LangGraph).
- [x] T4: Add `yaml` dependency, vitest coverage for load/execute/compile, and package scripts.
- [x] T5: `build`, `test`, `typecheck`, `attw`, and `publint` green on Phase 3 step 5 slice.

## Deferred

- LangGraph `StateGraph` compilation and checkpointing (explicit non-goal for this slice).
- DAG edges beyond total stage order, parallelism, and conditional branches.
- Repository `pipelines/*.yaml` MVP content (directory still placeholder).
