---
template: llm-judge
slug: llm-judge
stability: experimental
phase: 0b
allowed-in-milestones: [M1, M2, M3, M4, M5]
purpose: |
  Scaffold for `kind: llm-judge` clauses. The MVP fallback when no
  deterministic runner applies. Carries the quorum, cost ceiling, and
  worked-examples discipline that Layer 2 requires for `severity: block`.
references:
  - kind: lines
    path: /lib/memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Wrapper schema reference."
  - kind: lines
    path: /lib/memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Layer 2 (LLM-judge) requirements."
---

# Template — `kind: llm-judge`

Use this template for qualitative judgments with no deterministic runner:
adopter-friendliness of a README, narrative coherence of a delivery report,
ergonomic quality of a TypeScript public API.

Forbidden uses: structural assertions (use `rego`), API conformance (use
`schemathesis`, M2+), accessibility (use `axe`, M2+).

## Slots

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. |
| `severity` | yes | `block` requires quorum and cost ceiling. |
| `applies_to` | yes | Pick one of the five discriminators. |
| `owner` | yes | MUST exist in `lib/personas/`. |
| `description` | yes | EARS-disciplined, atomic, glossary-resolved. |
| `references` | yes | Dual-anchor citations on every external standard. |
| `runtime.rubric.scale` | yes | Anchored at `[1.0, 0.5, 0.0]`. |
| `runtime.rubric.threshold` | yes | Default `0.75`. |
| `runtime.rubric.examples.good` | yes | At least one worked positive example. |
| `runtime.rubric.examples.bad` | yes | At least one worked negative example. |
| `runtime.panel.quorum` | yes-if-block | `<N>-of-<M>` with `M >= 3` and `N >= 2`. |
| `runtime.panel.judges` | yes-if-block | Length equals `M`. |
| `runtime.panel.seed` | yes-if-block | Fixed integer for replay. |
| `runtime.panel.cost_ceiling_usd` | yes | At most `1.00`. |

## Scaffold

```yaml
id: <reverse-DNS id>                                # REQUIRED
kind: llm-judge
severity: <block | warn | info>                     # REQUIRED
applies_to:
  kind: <artifact-symbol | pipeline-telemetry | file-path | run-log-event | pancreator-config>
  # discriminator-specific fields
owner: <persona-name>                               # REQUIRED
description: |                                      # REQUIRED — EARS, atomic
  When <trigger>, the <subject> SHALL <response>.
references:                                         # REQUIRED — dual-anchor
  - kind: <symbol | lines>
    path: <repo-relative path>
    # symbol or range
    contentHash: <sha256>
    note: <short string>
runtime:
  rubric:
    scale: [1.0, 0.5, 0.0]                          # REQUIRED — anchored
    threshold: 0.75                                 # REQUIRED
    examples:
      good:                                         # REQUIRED — at least one
        - text: |
            <verbatim positive example>
          rationale: <one sentence>
      bad:                                          # REQUIRED — at least one
        - text: |
            <verbatim negative example>
          rationale: <one sentence>
    references:                                     # OPTIONAL — judgment-criteria sources
      - <URL or repo-relative path>
  panel:                                            # REQUIRED for severity: block
    quorum: 2-of-3
    judges: [haiku, haiku, sonnet]
    seed: 42
    cost_ceiling_usd: 0.50
metadata:
  pancreator.contract_id: <id>                       # REQUIRED — mirrors clause.id
  pancreator.applies_to: <serialized applies_to>     # REQUIRED
```

## Worked example

```yaml
id: pancreator.adopter.readme.adopter-friendly
kind: llm-judge
severity: block
applies_to:
  kind: artifact-symbol
  path: README.md
  symbol: "# Quickstart"
  contentHash: TBD-on-commit
owner: contract-writer
description: |
  When the `# Quickstart` section of `README.md` is rendered, the adopter
  SHALL be able to install the package, configure the minimum required
  values, and run the first example in at most 5 commands.
references:
  - kind: lines
    path: /lib/memory/handbook/contract-format.md
    range: [283, 283]
    contentHash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    note: "README discipline anchor."
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

## Failure-handling

The runner halts the panel on three conditions: cost overage, quorum
unreachable after 3 retries, or a judge returning an unparseable verdict.
Each halt routes via inbox per `/lib/memory/handbook/contract-style.md` Layer 1.
