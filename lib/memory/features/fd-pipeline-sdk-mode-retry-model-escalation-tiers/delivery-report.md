# Delivery Report — fd-pipeline-sdk-mode-retry-model-escalation-tiers

## Summary

This delivery adds declarative SDK model escalation tiers for feature-delivery retries. Operators configure `pancreator-model-escalation.yaml` at the repository root; active config resolves from `PAN_MODEL_ESCALATION_CONFIG`, then `runner.cursor.model_escalation.config` in `pancreator.yaml`, then the file-level `active_config`. `CursorRunner.invoke` selects the effective model from persona tier maps keyed by `stageInvocationIndex`, walks a model-issue fallback chain, and records escalation fields in `run.log.jsonl`. The CLI persists `stageInvocationIndex` before each SDK call, increments it on same-stage loopbacks, and resets it on stage success or retry-budget halt. Review and QA gates report zero must-fix findings; eleven automated verification commands exit zero.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/implementation-report.md",
  "range": [3, 15],
  "contentHash": "82dad73"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [3, 6],
  "contentHash": "0290c5b"
}
```

## Architecture

- The repository adds one declarative escalation surface at the root, threads `stageInvocationIndex` through the SDK feature-delivery loop, and keeps model selection policy inside `@pancreator/runner-cursor` rather than scattering it across CLI and transport layers.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/plan.md",
  "range": [10, 13],
  "contentHash": "0b6e127"
}
```

- Active config precedence is `PAN_MODEL_ESCALATION_CONFIG` over `pancreator.yaml` over the file-level `active_config`; `CursorRunner.invoke` owns tier resolution, fallback orchestration, and escalation observability while the transport stays a single-attempt primitive with one invocation-scoped model override.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/adr-draft.md",
  "range": [48, 65],
  "contentHash": "8c5c061"
}
```

- `FeatureDeliveryAutomationState` gains `stageInvocationIndex` persisted in `state.json` before every SDK invocation; the counter resets on first entry to a new stage, increments on same-stage loopback, and resets on successful stage completion or retry-budget halt without a separate escalation snapshot object.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/adr-draft.md",
  "range": [61, 76],
  "contentHash": "8c5c061"
}
```

- The model-issue classifier is a pure function over `CursorSdkInvokeResult` that matches explicit model-selection and capacity failures while excluding missing-artifact and stage-logic errors from the fallback path.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/adr-draft.md",
  "range": [67, 76],
  "contentHash": "8c5c061"
}
```

## Interfaces

- `loadModelEscalationConfig`, `resolveEffectiveModel`, `buildFallbackChain`, and `isModelIssue` implement config loading, tier resolution, fallback ordering, and model-issue classification in `@pancreator/runner-cursor`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/model-escalation.ts",
  "range": [143, 256],
  "contentHash": "e0aeaef"
}
```

- `ModelEscalationConfigError` and the escalation config interfaces (`PersonaEscalationTiers`, `NamedEscalationConfig`, `ModelEscalationFileConfig`, `LoadedModelEscalation`) define the typed config surface and validation errors.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/model-escalation.ts",
  "range": [8, 30],
  "contentHash": "e0aeaef"
}
```

- `CursorRunner.invoke` resolves the effective model from the active escalation config and `stageInvocationIndex`, passes a one-shot override to the SDK transport, and orchestrates the model-issue fallback chain with run-log escalation records.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/cursor-runner.ts",
  "range": [37, 80],
  "contentHash": "9625301"
}
```

- `createDefaultCursorSdkTransport` accepts `modelOverride` to supersede the static `persona.model` field for one invocation while `resolveSdkModelId` strips bracket qualifiers only at the SDK boundary.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts",
  "range": [74, 103],
  "contentHash": "e94c6ad"
}
```

- `prepareStageInvocationIndexForSdkEntry` and `resetStageInvocationIndex` manage the per-stage invocation counter in feature-delivery automation state; the CLI wires `appendEscalationLog` into `CursorRunnerOptions` to avoid a horizontal run-logger dependency in runner-cursor.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts",
  "range": [130, 151],
  "contentHash": "2a0a648"
}
```

- `pancreator-model-escalation.yaml` ships the canonical `default` config with `coder` and `reviewer` persona tier maps including integer-keyed escalation tiers.

```json
{
  "kind": "lines",
  "path": "pancreator-model-escalation.yaml",
  "range": [1, 14],
  "contentHash": "60a1dd9"
}
```

## Tradeoffs

- Manual mode, persona markdown, non-feature-delivery pipelines, and the cumulative retry budget remain unchanged; escalation applies only when `runner.cursor.invocation` is `sdk`.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/adr-draft.md",
  "range": [97, 98],
  "contentHash": "8c5c061"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/review.md",
  "range": [3, 6],
  "contentHash": "0cf734a"
}
```

- Escalation run-log appends move to the CLI via an injectable callback rather than importing `@pancreator/run-logger` from runner-cursor, preserving package boundary hygiene at the cost of one extra wiring site in `createCursorRunner`.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/implementation-report.md",
  "range": [12, 13],
  "contentHash": "82dad73"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/review.md",
  "range": [13, 15],
  "contentHash": "0cf734a"
}
```

- The loader uses inline structural validation instead of loading the JSON Schema at runtime; compliance fixtures cover the shipped config file, but schema parity at load time remains a follow-up.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/review.md",
  "range": [17, 18],
  "contentHash": "0cf734a"
}
```

- Model-escalation symbols are not re-exported from `runner-cursor/src/index.ts` by intentional revert; consumers call through `CursorRunner.invoke` rather than importing resolver helpers directly.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/review.md",
  "range": [21, 22],
  "contentHash": "0cf734a"
}
```

## Usage guidelines

- To resolve tier semantics at indices 0, 1, 3, and 5, call `resolveEffectiveModel` with a loaded config; the unit suite asserts default, gap, exact-key, and highest-below behavior.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/model-escalation.test.ts",
  "range": [35, 45],
  "contentHash": "cbf46b3"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [16, 17],
  "contentHash": "0290c5b"
}
```

- To override the active config name at runtime, set `PAN_MODEL_ESCALATION_CONFIG`; the test suite confirms it takes precedence over `pancreator.yaml` and the file-level `active_config`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/src/model-escalation.test.ts",
  "range": [57, 76],
  "contentHash": "cbf46b3"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [29, 30],
  "contentHash": "0290c5b"
}
```

- To track same-stage loopbacks, call `prepareStageInvocationIndexForSdkEntry` before each SDK entry; the test asserts increment on loopback and reset on new-stage entry.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.test.ts",
  "range": [264, 291],
  "contentHash": "f6e38c9"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [26, 27],
  "contentHash": "0290c5b"
}
```

- To verify escalated model selection on the second implement loopback under SDK mode, run the `invokeFeatureDeliveryEnteringStage` integration test against a mock transport with a tier-1 override.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.test.ts",
  "range": [293, 377],
  "contentHash": "f6e38c9"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [7, 8],
  "contentHash": "0290c5b"
}
```

## Testing

The coverage delta adds tier resolution, fallback ordering, environment override precedence, model-issue classification, transport override wiring, and feature-delivery loopback and reset semantics across `@pancreator/runner-cursor` (21 tests), `@pancreator/cli` (94 tests), repository-level `node --test tests/*.test.mjs` (144 tests), compliance validation, and scaffold checks. Statement coverage on new production lines is estimated above 90 percent; branch coverage is estimated near 80 percent with remaining gaps on pancreator.yaml override fixtures and chain-exhaustion halt integration.

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/test-report.md",
  "range": [7, 21],
  "contentHash": "0290c5b"
}
```

```json
{
  "kind": "lines",
  "path": "work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/review.md",
  "range": [37, 39],
  "contentHash": "0cf734a"
}
```
