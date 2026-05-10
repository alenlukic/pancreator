---
template: behavior-preservation
slug: behavior-preservation
stability: experimental
phase: 0b
allowed-in-milestones: [M1 (rego over test-result JSON), M3 (full 5-tier composite)]
purpose: |
  Scaffold for behavior-preservation contracts that gate refactors. The
  full M3 contract is a 5-tier composite: existing tests, mutation-test
  score, property tests, public-API diff, snapshot tests. M1 ships tier 1
  via `rego` over test-result JSON; the other tiers ratchet on as their
  runners land.
references:
  - kind: lines
    path: /src/memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Wrapper schema reference."
  - kind: lines
    path: docs/PRD.md
    range: [715, 715]
    contentHash: 52b0ae27bfc401fe4b1644636d33106e4d856de5f68b632fa8bc5a6e4a15972a
    note: "PRD §7 — `behavior-preservation` 5-tier composite definition."
external:
  - https://stryker-mutator.io
  - https://hypothesis.readthedocs.io
  - https://api-extractor.com
---

# Template — Behavior-Preservation contract

Use this template for clauses gating refactors authored by the `groomer`
persona (US-7) or by any task labelled `refactor`. The composite contract
SHALL preserve observable behavior across five tiers; each tier is gated
independently and aggregated under one wrapper.

## The 5 tiers

| Tier | Assertion | M1 runner | M3 runner |
|---|---|---|---|
| 1 | All existing tests pass after the change. | `rego` over `vitest --reporter=json` | `vitest`/`jest`/`pytest` |
| 2 | Mutation-test score does not regress. | manual; tracked as lint-debt | `stryker` / `pitest` / `mutmut` / `cargo-mutants` |
| 3 | Property-based tests pass. | manual; tracked as lint-debt | `hypothesis` / `fast-check` |
| 4 | Public-API diff is non-breaking. | `rego` over `attw --format json` + `publint --json` | `api-extractor` / `cargo-public-api` / `japicmp` |
| 5 | Snapshot tests pass. | `rego` over snapshot-runner JSON | `jest` / `verify` / `approval-tests` |

The M1 contract gates tiers 1, 4, and 5 deterministically; tiers 2 and 3
SHALL be tracked as `tesseract.lint-debt` until their runners land in M3.

## Slot map

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. Convention: `<feature>.behavior-preservation`. |
| `kind` | yes | M1: `rego` (composite). M3: omitted (each tier gets its own clause). |
| `severity` | yes | Always `block` for refactor pull requests. |
| `applies_to` | yes | Default discriminator: `pipeline-telemetry` against the refactor pipeline. |
| `owner` | yes | `groomer` (M3+) or `reviewer` (M1). |
| `description` | yes | EARS, atomic, tier-named. |
| `references` | yes | Cite the refactor RFC and the test-suite baseline. |
| `runtime` | yes | Per-kind payload. |
| `metadata.tesseract.tiers-enforced` | yes | Array subset of `[1, 2, 3, 4, 5]`. |
| `metadata.tesseract.tiers-deferred` | yes | Array subset of `[1, 2, 3, 4, 5]` with `tesseract.lint-debt` justifications. |

## M1 scaffold (`kind: rego` — composite)

```yaml
id: <feature>.behavior-preservation
kind: rego
severity: block
applies_to:
  kind: pipeline-telemetry
  pipeline: debt-grooming
  metric: aggregated-behavior-preservation
  window: per-run
owner: reviewer
description: |
  When the `debt-grooming` pipeline runs in `auto-pr` mode, the
  consolidated test-result JSON SHALL show every existing test passing,
  every snapshot test passing, and the public-API diff reporting zero
  breaking changes.
references:
  - kind: lines
    path: /src/memory/rfc/draft/<refactor-rfc>.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "Refactor RFC."
  - kind: lines
    path: docs/PRD.md
    range: [715, 715]
    contentHash: 52b0ae27bfc401fe4b1644636d33106e4d856de5f68b632fa8bc5a6e4a15972a
    note: "PRD §7 — behavior-preservation 5-tier definition."
spec: /src/memory/features/<id>/contracts/behavior-preservation.rego
runtime:
  package: tesseract.refactor.behavior_preservation
  query: data.tesseract.refactor.behavior_preservation.deny
metadata:
  tesseract.contract_id: <feature>.behavior-preservation
  tesseract.applies_to: pipeline-telemetry:debt-grooming#aggregated-behavior-preservation
  tesseract.tiers-enforced: [1, 4, 5]
  tesseract.tiers-deferred: [2, 3]
tesseract:
  lint-debt:
    - rule-id: behavior-preservation.tier-2-mutation-score
      reason: "Stryker runner lands at M3; manual review until then."
      due: "M3"
    - rule-id: behavior-preservation.tier-3-property-tests
      reason: "fast-check / Hypothesis runners land at M3; manual review until then."
      due: "M3"
```

Sidecar `behavior-preservation.rego`:

```rego
# METADATA
# title: Behavior-preservation composite (tiers 1, 4, 5)
# description: |
#   When the `debt-grooming` pipeline runs in `auto-pr` mode, the
#   consolidated test-result JSON SHALL show every existing test passing,
#   every snapshot test passing, and the public-API diff reporting zero
#   breaking changes.
# severity: block
# references:
#   - "/src/memory/handbook/contract-templates/behavior-preservation.template.md"
# custom:
#   tesseract.contract_id: <feature>.behavior-preservation
#   tesseract.applies_to: pipeline-telemetry:debt-grooming#aggregated-behavior-preservation
package tesseract.refactor.behavior_preservation

import rego.v1

deny contains msg if {
  some t in input.tests.failed
  msg := sprintf(
    "Tier 1 — When the existing test `%v` fails after the refactor, behavior preservation SHALL fail.",
    [t.name]
  )
}

deny contains msg if {
  count(input.snapshots.failed) > 0
  msg := "Tier 5 — When any snapshot test fails after the refactor, behavior preservation SHALL fail."
}

deny contains msg if {
  some change in input.public_api.breaking
  msg := sprintf(
    "Tier 4 — When the public API exports a breaking change `%v`, behavior preservation SHALL fail.",
    [change.symbol]
  )
}
```

## M3 evolution

At M3, the composite splits into one clause per tier. Each tier carries its
own runner, its own `severity`, and its own owner. The aggregator clause
remains as a Layer 4 invariant: at most one clause MAY gate the same
`applies_to` anchor at `severity: block` (see
`/src/memory/handbook/contract-style.md` Rule 4.3).

## Failure-handling

Behavior-preservation failures route to `groomer` (M3+) or to the human via
inbox (M1). The PR is blocked from merge until the failing tier is fixed or
the refactor is reverted; no soft override is permitted on `severity: block`.
