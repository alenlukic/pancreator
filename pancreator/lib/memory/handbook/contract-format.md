---
title: Contract Wrapper Schema Reference
slug: contract-format
stability: experimental
bootstrap-only: false
phase: 0b
owners: [contract-writer, librarian]
purpose: |
  The kind-agnostic wrapper schema every contract clause shares, the
  closed-core kind registry, the open-registry namespace rule, the
  `ContractRunner` adapter, the `ContractFailure` shape, and the LLM-judge
  quorum policy. The canonical reference for `contract-writer` and the
  `author-contract` skill.
references:
  - kind: lines
    path: .docs/PRD.md
    range: [260, 260]
    contentHash: 2eb6aa4
    note: "PRD §4 glossary — Spec Contract definition."
  - kind: lines
    path: .docs/PRD.md
    range: [839, 839]
    contentHash: 2eb6aa4
    note: "PRD §7 — `Spec contracts are gates, not suggestions` paragraph."
  - kind: lines
    path: .docs/PRD.md
    range: [435, 435]
    contentHash: 2eb6aa4
    note: "PRD §5.5 — conformance-target list (Conftest/Rego, Cedar, etc.)."
related:
  - /lib/memory/handbook/glossary.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/contract-templates/
  - /lib/personas/skills/author-contract/SKILL.md
external:
  - https://www.openpolicyagent.org
  - https://www.conftest.dev
  - https://schemathesis.io
  - https://playwright.dev
  - https://github.com/dequelabs/axe-core
---

# Contract Wrapper Schema

A contract clause is a YAML object that gates an artifact, a pipeline stage,
or a configuration value. Every clause shares a kind-agnostic wrapper. The
wrapper dispatches to a per-kind runner. This file defines the wrapper, the
runner adapter, the failure shape, and the kind registry.

Style discipline (RFC 2119, EARS, Layer 1 lint) lives in
`/lib/memory/handbook/contract-style.md`. This file is the structural reference.

## 1 — The wrapper

Every clause carries the fields below. Optional fields are marked.

```yaml
id: <reverse-DNS string>                      # required
kind: <closed-core or x-namespaced kind>      # required
severity: block | warn | info                  # required
applies_to:                                    # required
  kind: artifact-symbol | pipeline-telemetry | file-path | run-log-event | pancreator-config
  # plus discriminator-specific fields (§3 below)
owner: <persona-name>                          # required; MUST exist in lib/personas/
description: <RFC-2119 normative statement>    # required; Layer 1 disciplined
references:                                    # required; dual-anchor citations
  - kind: symbol | lines
    path: <repo-relative path>
    symbol: <AST symbol>            # when kind: symbol
    range: [<startLine>, <endLine>] # when kind: lines
    contentHash: <sha256 hex>
    note: <short string>
runtime:                                       # per-kind payload (§4 below)
  # kind-specific fields
metadata:                                      # open extension map (§5 below)
  pancreator.contract_id: <id>
  pancreator.applies_to: <serialized applies_to>
  # plus any pancreator.* extensions
spec: <repo-relative path>                     # optional; sidecar pointer (rego, ts, py)
module: <repo-relative path>                   # optional; alternative sidecar pointer for rego
style: prose-ok                                # optional; opt-out from template-slot lint
pancreator:
  lint-debt:                                   # optional; tracked Layer 1 deferrals
    - rule-id: <lint rule id>
      reason: <short justification>
      due: <YYYY-MM-DD>
```

The `id` field is reverse-DNS to keep clauses globally addressable across
repos and orgs. Examples: `pancreator.core.no-horizontal-deps`,
`features.checkout.api.401-on-missing-token`,
`acme.security.threat-model.spoofing-mitigated`.

The wrapper validates against a Zod schema in `@pancreator/contract` from
Phase 3 step 2 onward. Until then, hand-check against this file.

## 2 — Closed-core kind registry

The kind list ratchets across milestones. Authors MUST refuse a kind outside
the milestone allowlist; the refusal opens an inbox item proposing a
kind-promotion ADR.

| Milestone | Kinds added | Runner |
|---|---|---|
| MVP (M1) | `rego` | `@pancreator/contract-runner-rego` (Conftest + OPA) |
| MVP (M1) | `llm-judge` | `@pancreator/contract-runner-llm-judge` |
| M2 | `playwright` | `@pancreator/contract-runner-playwright` |
| M2 | `schemathesis` | `@pancreator/contract-runner-schemathesis` |
| M2 | `axe` | `@pancreator/contract-runner-axe` (`@axe-core/playwright`) |
| M3 | `semgrep` | `@pancreator/contract-runner-semgrep` |
| M3 | `hypothesis` | `@pancreator/contract-runner-hypothesis` |
| M3 | `fast-check` | `@pancreator/contract-runner-fast-check` |
| M3 | `ts-predicate` | `@pancreator/contract-runner-ts-predicate` |
| M3 | `py-predicate` | `@pancreator/contract-runner-py-predicate` |

Closed-core kinds carry no namespace prefix. The kind name MUST match the
runner package's published kind identifier.

## 3 — `applies_to` discriminators

The `applies_to.kind` field selects how the clause anchors to its target. The
five discriminators below form a closed enum.

### 3.1 — `artifact-symbol`

For clauses that gate a named symbol inside a Markdown or code artifact.
Resolved via tree-sitter or ast-grep.

```yaml
applies_to:
  kind: artifact-symbol
  path: /lib/memory/features/checkout/spec.md
  symbol: "Section: API Contract"
  contentHash: <sha256 hex>
```

### 3.2 — `pipeline-telemetry`

For clauses that gate a measured value emitted by the pipeline run-log.
Examples: coverage threshold, bundle-size delta, latency p95.

```yaml
applies_to:
  kind: pipeline-telemetry
  pipeline: feature-delivery
  metric: coverage.statement
  window: per-run
```

### 3.3 — `file-path`

For clauses that gate the existence, shape, or content of a file or glob
pattern.

```yaml
applies_to:
  kind: file-path
  glob: "lib/internal/packages/*/package.json"
  contentHash: <sha256 hex of glob-expanded payload, optional>
```

### 3.4 — `run-log-event`

For clauses that gate a specific span in the OpenInference + OTel GenAI
run-log. Used for agent-quality telemetry (debate convergence, sycophancy,
contract failures).

```yaml
applies_to:
  kind: run-log-event
  span_kind: AGENT
  attribute: pancreator.contract.id
  match: "*.security.*"
```

### 3.5 — `pancreator-config`

For clauses that gate a value inside `pancreator.yaml` (including its nested
`defaults:` block) or a per-feature `policy.yaml`.

```yaml
applies_to:
  kind: pancreator-config
  path: pancreator.yaml
  jsonpath: $.gates.coverage.statement.value
```

## 4 — Per-kind `runtime` payload

The `runtime` field carries the per-kind fields the runner needs. The schema
is closed per kind; unknown fields raise a Layer 1 error.

### 4.1 — `kind: rego`

```yaml
runtime:
  package: pancreator.coverage           # OPA package name
  query: data.pancreator.coverage.deny   # default: data.<package>.deny
  bundle: lib/internal/packages/policy/rego/         # optional; inherits from /policies/ default
spec: /lib/memory/features/<category>/<id>/contracts/<id>.rego  # required for non-inline rego
```

The Rego module MUST carry an OPA `# METADATA` block. See
`/lib/memory/handbook/contract-style.md` Layer 2.

### 4.2 — `kind: llm-judge`

```yaml
runtime:
  rubric:
    scale: [1.0, 0.5, 0.0]
    threshold: 0.75
    examples:
      good:
        - text: <verbatim positive example>
          rationale: <one sentence>
      bad:
        - text: <verbatim negative example>
          rationale: <one sentence>
  panel:
    quorum: 2-of-3                      # required for severity: block
    judges: [haiku, haiku, sonnet]      # 3 judges minimum for block
    seed: 42                            # required for replay
    cost_ceiling_usd: 0.50              # required; default 1.00
```

The `quorum` policy is enforced by the runner: it executes the panel and
records each judge's verdict. The clause passes when the configured majority
agrees. Cost above the ceiling halts the panel and routes via inbox.

### 4.3 — `kind: playwright` (M2+)

```yaml
runtime:
  test_describe: <contract id>          # MUST match clause.id exactly
  spec: /lib/memory/features/<category>/<id>/contracts/<id>.spec.ts
```

### 4.4 — `kind: schemathesis` (M2+)

```yaml
runtime:
  openapi: /apis/<service>/openapi.yaml
  endpoint: <method+path>
  examples:
    pass: <one passing fixture>
    fail: <one failing fixture>
```

### 4.5 — `kind: axe` (M2+)

```yaml
runtime:
  test_describe: <contract id>
  url: http://localhost:<port>/<route>
  rules: [color-contrast, label]
```

### 4.6 — Other M3+ kinds

`semgrep`, `hypothesis`, `fast-check`, `ts-predicate`, and `py-predicate`
each carry their own closed-payload schema. Authoring those is M3+; the
schemas are sketched under `/lib/memory/handbook/contract-templates/` when their
respective milestones land.

## 5 — `metadata` extension map

The `metadata` map is the open-extension surface. Recognized keys:

- `pancreator.contract_id` — required. Mirrors `clause.id`. Lets sidecar
  artifacts (Rego modules, TypeScript test files) cross-reference the wrapper
  without parsing the YAML.
- `pancreator.applies_to` — required. Serialized form of the wrapper's
  `applies_to`. Lets sidecar artifacts emit failure messages that route via
  ownership.
- `pancreator.cost-ceiling-usd` — per-clause override of the default cost cap.
- `pancreator.deprecated-by` — string. Names the superseding clause id.
- `pancreator.lint-debt` — array of deferred Layer 1 violations (see §1).

Keys not in this list raise a warning. The warning escalates to error in M3.

## 6 — Open-registry kinds (M2+)

When a needed assertion fits no closed-core kind and the milestone is M2 or
later, the author MAY use an open-registry kind under the `x-<owner>/<name>`
namespace. Examples: `x-acme/threat-model-stride`, `x-mycorp/gdpr-pii-scan`.

Open-registry kinds carry these obligations:

- The clause MUST cite a public spec under `references:`.
- The runner package MUST publish a `validatePayload(runtime: unknown)`
  function and ship a Zod schema for the runtime payload.
- The author MUST file an `ombudsperson` approval inbox item per PRD §13 R27
  before the clause is allowed to gate at `severity: block`.

In M1, open-registry kinds are forbidden. The contract-writer refuses and
opens a kind-promotion ADR instead.

## 7 — `ContractRunner` adapter

Every kind ships a runner that conforms to the interface below. Phase 3 step
2 lands the TypeScript declaration in `@pancreator/contract`.

```typescript
export interface ContractRunner<RuntimePayload = unknown, Result = unknown> {
  readonly kind: string;                    // matches wrapper.kind exactly
  validatePayload(runtime: unknown): RuntimePayload;
  run(args: {
    payload: RuntimePayload;
    appliesTo: AppliesTo;
    workdir: string;
    runLog: RunLogEmitter;
    costCeilingUsd: number;
  }): Promise<RunnerOutcome<Result>>;
}

export type RunnerOutcome<R> =
  | { status: "pass"; durationMs: number; cost?: { usd: number }; detail?: R }
  | { status: "fail"; durationMs: number; cost?: { usd: number }; failures: ContractFailure[] }
  | { status: "error"; durationMs: number; cost?: { usd: number }; error: string };
```

The runner emits one OpenInference span per `run()` invocation. The
supervisor aggregates outcomes against the wrapper's `severity` to decide
gate pass or halt.

## 8 — `ContractFailure` shape

When a clause fails, the runner emits one `ContractFailure` per discrete
violation. The supervisor and `tech-writer` consume this shape.

```typescript
export interface ContractFailure {
  contractId: string;            // wrapper.id
  appliesTo: AppliesTo;          // copied from wrapper
  severity: "block" | "warn" | "info";
  message: string;               // EARS-formatted; reuses the wrapper.description
  evidence: Evidence[];          // ≥1 item; failing input + actual + expected
  suggestion?: string;           // optional EARS-formatted remediation
  ownerPersona: string;          // copied from wrapper.owner
  routedTo?: string;             // pipeline stage to route the failure into
}

export interface Evidence {
  kind: "value" | "snippet" | "screenshot" | "log";
  source: string;                // path or run-log-span id
  payload: unknown;              // serializable; runner-defined
}
```

`message` MUST quote the wrapper's `description` verbatim. This makes
contract-failure routing grep-friendly across the run log.

## 9 — Worked example: `kind: rego`

The example below gates package-shape conformance. It uses the wrapper
verbatim and ships a sidecar Rego module.

```yaml
id: pancreator.core.no-horizontal-deps
kind: rego
severity: block
applies_to:
  kind: file-path
  glob: "lib/internal/packages/*/package.json"
owner: contract-writer
description: |
  When an `lib/internal/packages/<primitive>/package.json` declares a runtime dependency
  on another `@pancreator/<primitive>` package other than `@pancreator/core`,
  the contract-runner SHALL emit a block-level failure naming the offending
  package and the forbidden dependency.
references:
  - kind: lines
    path: .docs/PRD.md
    range: [434, 434]
    contentHash: 2eb6aa4
    note: "PRD §5.5 — `no horizontal dependencies between primitives` rule."
spec: /lib/memory/features/pancreator-core/contracts/no-horizontal-deps.rego
runtime:
  package: pancreator.deps
  query: data.pancreator.deps.deny
metadata:
  pancreator.contract_id: pancreator.core.no-horizontal-deps
  pancreator.applies_to: file-path:lib/internal/packages/*/package.json
```

## 10 — Worked example: `kind: llm-judge`

The example below gates a README's adopter-friendliness. It uses a 3-judge
quorum and a 0.50-USD cost ceiling.

```yaml
id: pancreator.adopter.readme.adopter-friendly
kind: llm-judge
severity: block
applies_to:
  kind: artifact-symbol
  path: README.md
  symbol: "# Quickstart"
  contentHash: c32e865
owner: contract-writer
description: |
  When the `# Quickstart` section of `README.md` is rendered, the adopter
  SHALL be able to install the package, configure the minimum required
  values, and run the first example in at most 5 commands.
references:
  - kind: lines
    path: .docs/PRD.md
    range: [438, 438]
    contentHash: 2eb6aa4
    note: "PRD §5.5 — README discipline (5-line minimum example)."
runtime:
  rubric:
    scale: [1.0, 0.5, 0.0]
    threshold: 0.75
    examples:
      good:
        - text: |
            ```
            npm install @pancreator/persona
            ```
            Then create `lib/personas/me.md` with the 16 frontmatter fields and
            run `pan persona validate`.
          rationale: Two commands; explicit file creation; named verifier.
      bad:
        - text: "Install the package and follow the standard pattern."
          rationale: Weasel words; no commands; no example.
  panel:
    quorum: 2-of-3
    judges: [haiku, haiku, sonnet]
    seed: 42
    cost_ceiling_usd: 0.50
metadata:
  pancreator.contract_id: pancreator.adopter.readme.adopter-friendly
  pancreator.applies_to: artifact-symbol:README.md#Quickstart
```

## 11 — How clauses register and load

Each feature folder carries a `contracts.index.json` mapping `clause.id` to
its sidecar path, owner persona, and `applies_to` anchor:

```json
{
  "clauses": [
    {
      "id": "features.checkout.api.401-on-missing-token",
      "path": "/lib/memory/features/checkout/contracts/401-on-missing-token.yaml",
      "owner": "appsec",
      "appliesTo": {
        "kind": "artifact-symbol",
        "path": "apis/checkout/openapi.yaml",
        "symbol": "paths./checkout.post.responses.401"
      }
    }
  ]
}
```

The pipeline's `contracts:from_feature` step reads this index, loads each
clause's wrapper, validates the per-kind payload, and dispatches to the named
runner.

## 12 — Stability

This file is the Phase 0b handbook seed. The wrapper field set is closed for
M1; new fields require an RFC under `/lib/memory/rfc/draft/` and a major version
bump on `@pancreator/contract`. Promotion to `stability: stable` follows
Phase 5 dogfood validation across the full M1 contract corpus.
