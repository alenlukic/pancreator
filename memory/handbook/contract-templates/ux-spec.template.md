---
template: ux-spec
slug: ux-spec
stability: experimental
phase: 0b
allowed-in-milestones: [M1 (llm-judge fallback), M2 (playwright + axe), M3+]
purpose: |
  Scaffold for UX-spec contract clauses. M2 swaps the LLM-judge fallback for
  deterministic Playwright + `@axe-core/playwright` runners. The clause shape
  is the same; only the `kind` and `runtime` fields move.
references:
  - kind: lines
    path: /memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: TBD-on-commit
    note: "Wrapper schema reference."
  - kind: lines
    path: /memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: TBD-on-commit
    note: "Layer 2 (axe + playwright) requirements."
external:
  - https://www.w3.org/WAI/standards-guidelines/wcag/
  - https://playwright.dev
  - https://github.com/dequelabs/axe-core
---

# Template — UX-Spec contract

Use this template for clauses gating focus states, contrast ratios, motion
budgets, accessibility minimums, or any other UX-spec assertion. The
clause lives alongside `ux-spec.md` in the feature folder.

## Slot map

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. Convention: `<feature>.ux.<assertion>`. |
| `kind` | yes | M1: `llm-judge`. M2+: `axe` or `playwright`. |
| `severity` | yes | UX clauses default `block` for accessibility, `warn` for motion. |
| `applies_to` | yes | Default discriminator: `artifact-symbol` against `ux-spec.md`. |
| `owner` | yes | `design-engineer` (M2+) or `contract-writer` (M1). |
| `description` | yes | EARS, atomic, quantified (contrast ratio, motion ms, etc.). |
| `references` | yes | Cite the WCAG criterion or design-system token. |
| `runtime` | yes | Per-kind payload. |
| `metadata.tesseract.wcag-criteria` | yes-if-a11y | Array of WCAG IDs (e.g., `["1.4.3", "2.4.7"]`). |
| `metadata.tesseract.motion-budget-ms` | optional | Maximum animation duration. |

## M1 scaffold (`kind: llm-judge` fallback)

```yaml
id: <feature>.ux.<assertion>                        # REQUIRED
kind: llm-judge
severity: block
applies_to:
  kind: artifact-symbol
  path: /memory/features/<id>/ux-spec.md
  symbol: <UX-spec section heading>
  contentHash: <sha256>
owner: contract-writer                              # M1; design-engineer at M2
description: |
  When the rendered component <selector> appears in any viewport,
  the frontend SHALL <observable response>.
references:
  - kind: lines
    path: /memory/features/<id>/ux-spec.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: <which UX-spec section this gates>
runtime:
  rubric:
    scale: [1.0, 0.5, 0.0]
    threshold: 0.75
    examples:
      good:
        - text: |
            <screenshot or DOM snippet showing the assertion satisfied>
          rationale: <one sentence>
      bad:
        - text: |
            <screenshot or DOM snippet showing the assertion violated>
          rationale: <one sentence>
  panel:
    quorum: 2-of-3
    judges: [haiku, haiku, sonnet]
    seed: 42
    cost_ceiling_usd: 0.50
metadata:
  tesseract.contract_id: <id>
  tesseract.applies_to: artifact-symbol:/memory/features/<id>/ux-spec.md#<symbol>
  tesseract.wcag-criteria: ["<WCAG ID>"]            # REQUIRED if a11y
```

## M2 scaffold (`kind: axe`)

```yaml
id: <feature>.ux.color-contrast
kind: axe
severity: block
applies_to:
  kind: artifact-symbol
  path: /memory/features/<id>/ux-spec.md
  symbol: "Section: Color and Contrast"
  contentHash: <sha256>
owner: design-engineer
description: |
  When the checkout summary view renders, every interactive element SHALL
  pass the WCAG 2.2 AA color-contrast criterion as measured by
  `@axe-core/playwright`.
references:
  - kind: lines
    path: /memory/features/<id>/ux-spec.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "UX-spec contrast requirements."
runtime:
  test_describe: <feature>.ux.color-contrast
  url: http://localhost:<port>/checkout/summary
  rules: [color-contrast]
metadata:
  tesseract.contract_id: <feature>.ux.color-contrast
  tesseract.applies_to: artifact-symbol:/memory/features/<id>/ux-spec.md#Color-and-Contrast
  tesseract.wcag-criteria: ["1.4.3"]
```

## M2 scaffold (`kind: playwright`)

```yaml
id: <feature>.ux.focus-trap
kind: playwright
severity: block
applies_to:
  kind: artifact-symbol
  path: /memory/features/<id>/ux-spec.md
  symbol: "Section: Modal Focus Behavior"
  contentHash: <sha256>
owner: design-engineer
description: |
  When the cart-empty modal opens, focus SHALL move to the modal container
  within 100 ms and SHALL NOT escape the modal until the modal closes.
references:
  - kind: lines
    path: /memory/features/<id>/ux-spec.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "UX-spec modal focus requirements."
spec: /memory/features/<id>/contracts/focus-trap.spec.ts
runtime:
  test_describe: <feature>.ux.focus-trap
metadata:
  tesseract.contract_id: <feature>.ux.focus-trap
  tesseract.applies_to: artifact-symbol:/memory/features/<id>/ux-spec.md#Modal-Focus-Behavior
  tesseract.wcag-criteria: ["2.4.3", "2.4.7"]
```

## Failure-handling

UX-spec failures route to `frontend-eng` (M2+) or `coder` (M1) with the
failed contract id and the worked-bad example as evidence. The runner emits
an `axe.violations[*]` payload that the Reviewer surfaces in the review
artifact.
