# ADR Draft — Opt-In CursorRunner Execution for Feature Delivery

## Status

Draft for human ratification at the `plan` stage.

## Context

`feature-delivery` currently stores stage state and prompt artifacts, but it does not execute stage work except for one intake smoke call that uses `stubPersonaForStage`. `advanceFeatureDelivery` remains fully manual. The M1 substrate already contains `CursorRunner`, `compilePipeline`, and `executePipeline`, so the remaining gap is CLI orchestration. Citation: `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [97, 103], contentHash: "a96eccf"}`.

ADR-0002 separates current repository substrate from planned runtime behavior. This decision upgrades one planned runtime edge to an executable, opt-in path while preserving the manual substrate. Citation: `{kind: lines, path: "src/memory/adr/0002-system-architecture-map.md", range: [102, 135], contentHash: "3574b43"}`.

ADR-0003 and ADR-0005 define inbox lifecycle and timestamp naming. The retry-limit halt and report approval gate therefore MUST write system-produced outbox files that follow the existing inbox and timestamp rules. Citations: `{kind: lines, path: "src/memory/adr/0003-inbox-lifecycle-and-archival.md", range: [52, 109], contentHash: "9187a27"}` and `{kind: lines, path: "src/memory/adr/0005-timestamp-naming-conventions.md", range: [35, 60], contentHash: "8b59da5"}`.

## Decision

When `runner.cursor.invocation` is omitted or equals `manual`, the CLI SHALL preserve the existing feature-delivery handoff-and-paste flow.

When `runner.cursor.invocation` equals `sdk`, `ddl run feature-delivery` and `ddl advance` SHALL invoke the entering stage through one shared Cursor runner contract.

The CLI SHALL resolve persona specs from `src/personas/<name>.md`; no live path SHALL use synthetic persona data.

The CLI SHALL load repo-root `.env` before constructing `CursorRunner`; secret values SHALL remain process-local and SHALL NOT be written to logs or artifacts.

The CLI SHALL execute each SDK-backed stage invocation through a compiled graph slice derived from `compilePipeline`, rather than through a parallel imperative executor.

The runtime SHALL store SDK-only automation state in `state.json`, including invocation mode and cumulative retry count, so loopbacks and reinvocation keep ledger continuity.

The runtime SHALL pause at the report approval gate and retry-limit halt through timestamp-prefixed `src/inbox/out/<day-bucket>/` artifacts.

## Consequences

- Positive: Manual mode remains stable for operators who do not opt into SDK execution.
- Positive: SDK mode exercises the same persona, prompt, artifact, and ledger contract on both run and advance.
- Positive: The implementation closes the WP-B residual runner gap without replacing the human report and ship gates.
- Negative: The feature-delivery ledger gains automation state and outbox decision parsing, increasing test surface in `@daedaline/cli`.
- Negative: The pipeline package may need a stage-slice helper to keep graph execution bounded to one stage.
- Neutral: Live SDK calls remain outside default CI; unit tests use mocked transport.

## Rejected Alternatives

- **Always invoke SDK when `CURSOR_API_KEY` exists.** Rejected because the spec requires manual mode as the default and explicit opt-in through configuration.
- **Keep `stubPersonaForStage` as a fallback.** Rejected because acceptance criteria require real persona fields and typed failure for unknown personas.
- **Implement automation as a separate state machine.** Rejected because the spec requires compiled graph integration and the existing intervention side-channel.

## References

- `{kind: lines, path: "src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md", range: [123, 181], contentHash: "a96eccf"}`
- `{kind: lines, path: "src/memory/adr/0002-system-architecture-map.md", range: [102, 135], contentHash: "3574b43"}`
- `{kind: lines, path: "src/memory/adr/0003-inbox-lifecycle-and-archival.md", range: [52, 109], contentHash: "9187a27"}`
- `{kind: lines, path: "src/memory/adr/0005-timestamp-naming-conventions.md", range: [35, 60], contentHash: "8b59da5"}`
- `{kind: symbol, path: "src/internal/packages/@daedaline/cli/src/feature-delivery-run.ts", symbol: "startFeatureDelivery", contentHash: "7c5e4d7"}`
- `{kind: symbol, path: "src/internal/packages/@daedaline/runner-cursor/src/cursor-runner.ts", symbol: "CursorRunner.invoke", contentHash: "87b4929"}`
- `{kind: symbol, path: "src/internal/packages/@daedaline/pipeline/src/execute.ts", symbol: "executePipeline", contentHash: "d86f5e2"}`
