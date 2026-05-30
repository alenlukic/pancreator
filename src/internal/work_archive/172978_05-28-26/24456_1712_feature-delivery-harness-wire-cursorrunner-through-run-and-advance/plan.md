# Plan — feature-delivery harness CursorRunner wiring

The implement stage SHALL replace the one-off intake smoke with an opt-in `CursorRunner` execution path shared by `pan run feature-delivery` and `pan advance`, while manual mode remains the default operator flow. The runtime MUST resolve real persona markdown, load repo-root `.env` before SDK construction, execute SDK-backed stage slices through the compiled pipeline graph, append runner observability records, and enforce SDK-only automatic loopback rules with a cumulative retry budget of 3. The plan satisfies WP-1 through WP-7 from the Engineering Spec. Citations: `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [123, 181], contentHash: "a96eccf"}` and `{kind: symbol, path: "src/internal/packages/@pancreator/cli/src/feature-delivery-run.ts", symbol: "startFeatureDelivery", contentHash: "7c5e4d7"}`.

## Implementation Phases

1. **Establish runtime seams without changing manual behavior.**
   - The implementor SHALL add a narrow feature-delivery runner orchestration helper in `feature-delivery-run.ts` that reads `runner.cursor.invocation`, loads repo-root `.env`, resolves `src/personas/<name>.md`, and builds one `RunnerInvokeInput` shape for both `run` and `advance`.
   - The implementor SHALL keep omitted `runner.cursor.invocation` and explicit `manual` behavior inert: no SDK transport call, unchanged JSON envelopes, and unchanged human paste loop.
   - The implementor SHALL remove `stubPersonaForStage` from all live code paths after the persona resolver is covered by tests.

2. **Drive SDK stage invocation through a compiled graph slice.**
   - The implementor SHALL compile the canonical `feature-delivery` pipeline before mutating `state.json`; unknown persona or compiler errors MUST exit non-zero and leave the ledger unchanged.
   - The implementor SHOULD add a small pipeline helper or CLI-local wrapper that executes exactly the entering stage through `executePipeline` with a one-stage slice derived from the loaded pipeline. This keeps the LangGraph side-channel node in use without advancing unrelated stages.
   - The stage step function SHALL call `CursorRunner.invoke` with `stagePromptPath`, expected artifact path, real persona, and ledger fields: `taskId`, `pipelineId`, `stageId`, and `featureId`.

3. **Persist runner observability and SDK outcomes.**
   - The implementor SHALL convert each returned runner envelope into exactly one `RunLogRecord` appended to `run.log.jsonl`.
   - The record SHALL include OpenInference and OTel GenAI attributes from `RunnerRunLogFragment`, plus Pancreator task, stage, persona, and outcome fields.
   - SDK transport errors SHALL stop the transition before state mutation and SHALL produce a non-zero CLI result.

4. **Implement SDK-only automatic transitions.**
   - After an SDK-invoked `review` stage emits `review.md`, `review_passes` SHALL route to `test`; `must_fix` SHALL route to `implement` and increment the cumulative retry counter.
   - After an SDK-invoked `test` stage emits `test-report.md`, `qa_passes` SHALL route to `report`; `qa_fails` SHALL route to `implement` or `plan` based on a parseable QA verdict and SHALL increment the same counter.
   - When the retry counter exceeds 3, the runtime SHALL set a terminal `halted` status, stop automation, print the required halt summary, and write one timestamp-prefixed outbox artifact.
   - When SDK automation reaches `report` and `delivery-report.md` exists, the runtime SHALL write one timestamp-prefixed report approval artifact and pause for human decision. An `approve` decision advances to `ship`; a `needs_changes` decision routes to the named `plan` or `implement` stage with run-log continuity.

5. **Update configuration and operator surfaces.**
   - The implementor SHALL document `runner.cursor.invocation: manual|sdk` in `pancreator.yaml` comments and `src/memory/handbook/pancreator-config.md`.
   - The implementor SHALL update `OPERATION.md` for opt-in SDK mode, `.env` handling, automatic `review` and `test` loopbacks, retry-limit halt artifacts, and the report approval gate.
   - The implementor SHALL update `src/memory/handbook/inbox-lifecycle.md` only for the new system-produced outbox artifact shapes.

6. **Add regression coverage.**
   - `@pancreator/cli` tests SHALL cover SDK `run`, SDK `advance`, manual no-SDK full path, persona resolver failure without `state.json` mutation, `.env` loading without secret output, retry-limit halt, report gate pause/resume, and explicit reinvocation context.
   - `@pancreator/pipeline` tests SHALL cover the stage-slice execution helper if it lands in the pipeline package.
   - `@pancreator/runner-cursor` tests SHALL remain green and SHALL cover any changed run-log fragment span name or attributes.

## Risks

- The report approval gate can drift into a new command surface. The implementor SHOULD reuse `advance --artifact <outbox-decision>` for the decision artifact unless tests prove a dedicated command is required.
- The compiled graph currently walks stages in order. A one-stage slice minimizes blast radius while still exercising `compilePipeline` and the single intervention node.
- Cursor SDK calls MUST remain mocked in tests; live SDK smoke remains manual or scheduled only.
- `.env` parsing MUST avoid logging secrets and SHOULD support simple `KEY=value`, quotes, blank lines, and comments without introducing a new dependency.

## Validation Strategy

Run these gates before implementation is reported complete:

```bash
pnpm --filter @pancreator/cli test
pnpm --filter @pancreator/pipeline test
pnpm --filter @pancreator/runner-cursor test
node --test tests/*.test.mjs
node src/internal/tools/check-phase-0a-scaffold.mjs
node src/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
```

## Documentation Impact Decision

```yaml
documentation_impact:
  applies: true
  rationale: "This feature changes feature-delivery runtime behavior, runner configuration, .env loading, auto-loopback semantics, retry-limit halt output, and report approval flow."
  changed-surfaces:
    - OPERATION.md
    - src/memory/handbook/pancreator-config.md
    - src/memory/handbook/inbox-lifecycle.md
    - pancreator.yaml
  deferred-items: []
```

## Dual-Anchor Citations

- `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [97, 103], contentHash: "a96eccf"}`
- `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [123, 181], contentHash: "a96eccf"}`
- `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [183, 204], contentHash: "a96eccf"}`
- `{kind: lines, path: "src/pipelines/feature-delivery.yaml", range: [25, 67], contentHash: "a247fa7"}`
- `{kind: lines, path: "OPERATION.md", range: [26, 94], contentHash: "97a5bee"}`
- `{kind: symbol, path: "src/internal/packages/@pancreator/cli/src/feature-delivery-run.ts", symbol: "advanceFeatureDelivery", contentHash: "7c5e4d7"}`
- `{kind: symbol, path: "src/internal/packages/@pancreator/pipeline/src/compile.ts", symbol: "compilePipeline", contentHash: "f657d73"}`
- `{kind: symbol, path: "src/internal/packages/@pancreator/pipeline/src/execute.ts", symbol: "executePipeline", contentHash: "d86f5e2"}`
- `{kind: symbol, path: "src/internal/packages/@pancreator/runner-cursor/src/cursor-runner.ts", symbol: "CursorRunner.invoke", contentHash: "87b4929"}`
