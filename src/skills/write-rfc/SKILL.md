---
name: write-rfc
description: Authors one Request for Comments in the Rust-RFC-process shape. Picks a slug, fills the seven-section template (motivation, guide-level, reference-level, drawbacks, alternatives, prior art, unresolved questions), wires dual-anchor citations, runs Layer 1 lint, then files the draft under `/src/memory/rfc/draft/<slug>.md` for ensemble debate or human ratification.
license: Apache-2.0
metadata:
  tesseract-stability: experimental
  tesseract-bootstrap-only: false
  tesseract-pipeline-stages: [plan, rfc-debate, proactive-research-scan, debt-grooming]
  tesseract-risk-tier: medium
  tesseract-required-handbook:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
  tesseract-emits:
    - /src/memory/rfc/draft/<slug>.md
references:
  - kind: lines
    path: docs/PRD.md
    range: [506, 506]
    contentHash: TBD-on-commit
    note: "PRD §6 — MVP roster: tech-lead drafts the plan/RFC for any non-trivial change."
  - kind: lines
    path: docs/PRD.md
    range: [154, 167]
    contentHash: TBD-on-commit
    note: "PRD §3.5 US-5 — Scouts emit RFC drafts under `/src/memory/rfc/draft/`; ensembles + SMEs deliberate; PM folds accepted RFCs into the backlog."
  - kind: lines
    path: docs/PRD.md
    range: [708, 715]
    contentHash: TBD-on-commit
    note: "PRD §7 — `rfc-debate`, `proactive-research-scan`, and `debt-grooming` pipelines all emit or consume RFCs under `/src/memory/rfc/draft/`."
  - kind: lines
    path: docs/PRD.md
    range: [916, 919]
    contentHash: TBD-on-commit
    note: "PRD §8 — Memory architecture: `/src/memory/rfc/{draft,accepted,rejected}/` directory layout for in-flight, accepted, and rejected RFCs."
  - kind: lines
    path: docs/PRD.md
    range: [1004, 1010]
    contentHash: TBD-on-commit
    note: "PRD §8 — Anti-rot: dual-anchor citations on every RFC; rejected RFCs kept for legislative history."
---

# Skill — `write-rfc`

A reusable 7-step procedure for authoring one Request for Comments. The
canonical caller is `src/personas/tech-lead.md` (drafts an RFC when a `plan`
stage decision exceeds the ADR length budget or touches more than one
Feature). M3+ adds `groomer` (drafts a refactor RFC under `propose` mode per
PRD §7 line 715), and M4+ adds the scout family (each scout emits an RFC
draft per PRD §3.5 US-5 line 160) and `pm` (folds accepted RFCs into the
backlog per PRD §3.5 US-5 line 163).

## Prerequisites

- `/src/memory/rfc/draft/`, `/src/memory/rfc/accepted/`, and `/src/memory/rfc/rejected/`
  SHALL exist per PRD §8 lines 916 through 919.
- `/src/memory/handbook/glossary.md` SHALL exist; every domain noun in the RFC
  body resolves through this file.
- `/src/memory/handbook/contract-style.md` SHALL exist; the RFC body satisfies
  Layer 1 lint per PRD §4.6.
- The proposal SHALL be captured in an inbox item, a scout output, a
  `plan.md`, or a debt-inventory entry. Authoring an RFC without a
  triggering artifact MUST halt and route via inbox.

## The 7-step authoring loop

Execute these steps in order, once per RFC. Do not skip ahead.

### Step 1 — Resolve scope and pick a slug

The slug MUST be lowercase-kebab-case at most 8 words drawn from the
proposal title. Filename is `/src/memory/rfc/draft/<slug>.md`. When a draft RFC
already exists at the same slug, you MUST append a numeric suffix
(`-v2`, `-v3`, ...) and link the prior draft via `supersedes:` rather than
overwrite.

When the proposal touches a single Feature, you MUST also stage a copy at
`/src/memory/features/<id>/rfc-<slug>.md` and link it from the Feature's
`index.json` on the next `librarian` post_run sweep.

### Step 2 — Fill the RFC frontmatter

Every RFC MUST carry a YAML frontmatter block with the keys below. Missing
keys fail the gate.

```yaml
---
title: <one-line proposal title>
slug: <lowercase-kebab-case>
status: draft                  # draft | under-debate | accepted | rejected | superseded
date: <ISO-8601 date>
authors: [<persona-or-human-handle>, ...]
deciders: [<persona-or-human-handle>, ...]
supersedes: <prior-RFC slug, or null>
superseded-by: <future-RFC slug, or null>
target-milestone: <M0 | M1 | M2 | ... | M9+>
pipeline-binding: <pipeline name when the RFC modifies a pipeline, else null>
references:
  - kind: <symbol|lines>
    path: <repo-relative path>
    symbol: <symbol name when kind is symbol>
    range: <[start, end] when kind is lines>
    contentHash: TBD-on-commit
    note: <one-sentence summary of the cited content>
---
```

The `status` field MUST start at `draft` and SHALL transition to
`under-debate` only when the `rfc-debate` pipeline picks the RFC up
(M4+) or when the human reviewer opens the inbox thread (MVP fallback).

### Step 3 — Author the seven-section body

The RFC body MUST contain exactly seven `##` sections in this order. Each
section MUST satisfy the size and content constraints below.

1. **Summary.** One paragraph at most 80 words stating what the RFC
   proposes.
2. **Motivation.** One to three paragraphs answering: what problem does
   this solve, why now, and what happens if we do nothing? Every external
   claim MUST carry a dual-anchor citation per PRD §8.
3. **Guide-level explanation.** Explain the proposal as if onboarding a
   new engineer. Worked examples MUST appear here, not in the
   reference-level section. Use code blocks with the language tag for
   any code; reference-able prose for any policy or workflow.
4. **Reference-level explanation.** The implementation-grade
   specification: data shapes, public APIs, file paths, contract clauses
   that fall out, and migration steps. Every cross-reference MUST resolve
   to a dual-anchor citation per PRD §8.
5. **Drawbacks.** A bulleted list of explicit costs the RFC imposes. Each
   bullet MUST be one sentence; an empty list fails the gate (every
   non-trivial change has tradeoffs).
6. **Rationale and alternatives.** A bulleted list naming at least 2
   alternatives the RFC rejects, with one sentence per alternative
   explaining why it loses. Citing a paper, ADR, or RFC the alternative
   draws from MUST resolve via dual-anchor citation per PRD §8.
7. **Prior art and unresolved questions.** Two subsections. Prior art lists
   external references (papers, OSS implementations, prior internal RFCs)
   the RFC builds on. Unresolved questions lists at most 7 open questions
   the debate phase MUST close before the RFC promotes to `accepted`.

The full body MUST stay at most 3000 words across the seven sections
combined.

### Step 4 — Wire dual-anchor citations and the supersession chain

Every external claim MUST resolve to a dual-anchor citation per PRD §8 lines
1004 through 1010. Prefer `{kind: 'symbol', path, symbol, contentHash}` for
code references; fall back to `{kind: 'lines', path, range, contentHash}`
only for non-AST content.

When the RFC supersedes a prior RFC, you MUST set `supersedes:` to the
prior RFC's slug and route the prior RFC's `superseded-by:` update through
`librarian`'s next sweep. Rejected RFCs MUST NOT be deleted; they migrate
to `/src/memory/rfc/rejected/<slug>.md` per PRD §8 line 919.

### Step 5 — Author the ratification rubric

When `pipeline-binding:` is non-null, the RFC MUST include an inline
contract block per `/src/memory/handbook/contract-format.md` declaring the
gate the modified pipeline carries on acceptance. The block routes through
`contract-writer` and the `author-contract` skill on the same staging.

When the RFC proposes a change to `tesseract.yaml` thresholds, the
ratification rubric MUST cite the current measured baseline and the
proposed new value side-by-side per PRD §3.5 US-9 line 220.

### Step 6 — Run Layer 1 lint against the body

Apply the Layer 1 lint discipline declared in
`/src/memory/handbook/contract-style.md` to every normative clause in the RFC
body. Each rule MUST hold:

- One RFC 2119 obligation keyword per normative clause.
- One EARS template per normative clause.
- Active voice and present tense.
- Numeric claims quantified with units.
- No weasel words from the PRD §4.6 ban list.
- Every domain noun resolves to `/src/memory/handbook/glossary.md`.
- Median sentence length at most 30 words.
- p95 sentence length at most 40 words.

Apply at most 3 self-correction rounds. On the 4th unresolved violation, you
MUST escalate via inbox per the R29 friction-circuit-breaker pattern from
PRD §13.

### Step 7 — Stage the file and route the debate ask

When all gates are green, you MUST:

1. Stage the new file at `/src/memory/rfc/draft/<slug>.md` with `status:
   draft`. You MUST NOT commit; you MUST NOT push.
2. Open one inbox item at `src/inbox/in/<timestamp>-rfc-<slug>-debate.md`
   summarizing the proposal, the rejected alternatives, and the
   unresolved questions. The supervisor flips `status` to
   `under-debate` only after the human or the `rfc-debate` pipeline picks
   the inbox item up.
3. When `pipeline-binding:` is non-null, also route the inline contract
   block to `contract-writer` for clause-shape review on the same
   staging.
4. When the RFC supersedes a prior RFC, schedule the prior RFC's
   `superseded-by:` update through `librarian`'s next sweep; do NOT
   edit the prior RFC yourself.
5. Register the new RFC in the Feature's `index.json` when the RFC
   was authored under a Feature; the `librarian` runs the registration
   on the next post_run sweep.

## Stop conditions

- Halt when the triggering artifact (inbox item, scout output, `plan.md`,
  debt-inventory entry) is missing; do NOT invent a proposal.
- Halt when the proposal duplicates an `accepted` RFC by more than 50% of
  its scope; either supersede the prior RFC or merge.
- Halt when the proposed body exceeds 3000 words; either split into a
  parent + child RFC pair or move the implementation detail to a sidecar
  contract clause.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.
- Halt when any dual-anchor citation reports `gone` per the content-hash
  verifier; refresh the anchor or open an inbox item.

## Cost guards (PRD §13 R8 for scout RFCs)

- Per-RFC draft default `max_tokens: 24000`. Bodies above 3000 words MUST
  trip a hard halt; split or sidecar the surplus.
- Scout-emitted RFCs MUST stay under the per-scout weekly cost ceiling
  declared in `tesseract.yaml: scouts.<name>.weekly_dollar_ceiling`. On
  ceiling-breach, the scout MUST halt and post an inbox item per PRD §13
  R8.
