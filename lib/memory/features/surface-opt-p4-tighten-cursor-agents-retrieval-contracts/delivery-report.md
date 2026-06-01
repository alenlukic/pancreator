# Delivery Report — surface-opt-p4-tighten-cursor-agents-retrieval-contracts

## Summary
This report SHALL record the delivery state for surface-opt P4. R1–R3 implementation work is complete, and AC4 remains open because the persona-designer review note is missing from the handoff. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/implementation-report.md",
  "range": [10, 18],
  "contentHash": 0
}
```
 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/spec.md",
  "range": [51, 72],
  "contentHash": "49a3950"
}
```
 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/review.md",
  "range": [31, 35],
  "contentHash": 0
}
```


## Delivered changes
- The 15 `.cursor/agents/*.md` projections SHALL read `next-prompt.md` first, SHALL gate broad reads behind explicit escalation conditions, and SHALL avoid duplicating source-owned `tools`, `disallowedTools`, and `metadata` YAML. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/implementation-report.md",
  "range": [10, 17],
  "contentHash": 0
}
```

- The contract test suite SHALL cover AC1–AC3 across the projections, and the context-budget report test SHALL align with the new projection frontmatter shape. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/implementation-report.md",
  "range": [30, 37],
  "contentHash": 0
}
```

- Persona sources remain unchanged, satisfying the out-of-scope bounds for persona semantics. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/implementation-report.md",
  "range": [72, 76],
  "contentHash": 0
}
```


## Gate status
- review_passes: false. The review gate SHALL remain blocked until the persona-designer review note is recorded in the handoff. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/review.md",
  "range": [31, 35],
  "contentHash": 0
}
```

- qa_passes: true. QA reports all automated checks passing. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/test-report.md",
  "range": [1, 15],
  "contentHash": 0
}
```

- open_requirements: AC4. The run SHALL record exactly 1 persona-designer review note before advance. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/spec.md",
  "range": [71, 72],
  "contentHash": "49a3950"
}
```


## Review and QA notes
- The review gate lists 1 must-fix item: add the persona-designer review note to the handoff. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/review.md",
  "range": [31, 35],
  "contentHash": 0
}
```

- QA SHALL treat lint, typecheck, compliance, scaffold, context-budget, and test suite runs as passing, with a warning that the test runner logged non-fatal git repository messages. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/test-report.md",
  "range": [7, 19],
  "contentHash": 0
}
```


## Documentation impact
No additional handbook or operator documentation updates are required for this slice. 

```json
{
  "kind": "lines",
  "path": "work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/implementation-report.md",
  "range": [78, 80],
  "contentHash": 0
}
```


## Next operator steps
- What: Record the required persona-designer review note in `work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/handoff.md` to satisfy AC4 and unblock the review gate. How: invoke `/persona-designer` and direct it to append 1 review note to the handoff file, then re-check that `review_passes` is true before advancing. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/spec.md",
  "range": [71, 72],
  "contentHash": "49a3950"
}
```


