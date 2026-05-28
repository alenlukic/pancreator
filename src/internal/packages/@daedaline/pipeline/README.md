# @daedaline/pipeline

YAML `PipelineDefinition` types, a disk loader, an ordered in-process `executePipeline` driver, and a `compilePipeline` stub (no LangGraph runtime dependency).

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/pipeline run build
pnpm --filter @daedaline/pipeline test
pnpm --filter @daedaline/pipeline run typecheck
```

`loadPipelineYaml` reads a mapping with `id` and `stages` (each stage requires `id`). `executePipeline` walks stages in file order and threads a caller-defined context.

## Scope

- This package depends only on `@daedaline/core`, `yaml`, and Node built-ins.
- LangGraph `StateGraph` compilation and remote schedulers are deferred to later slices.
