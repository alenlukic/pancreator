---
name: write-adr
description: Authors one immutable Architecture Decision Record in the Nygard format. Picks the next sequence number, fills the four-section template (context, decision, status, consequences), wires `supersedes:` and dual-anchor citations, runs Layer 1 lint, then files under `/src/memory/adr/<seq>-<slug>.md` for human ratification.
license: Apache-2.0
metadata:
  tesseract-stability: experimental
  tesseract-bootstrap-only: false
  tesseract-pipeline-stages: [plan, review, knowledge-curation]
  tesseract-risk-tier: medium
  tesseract-required-handbook:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
  tesseract-emits:
    - /src/memory/adr/<seq>-<slug>.md
    - /src/work/<day>/<id>/adr-draft.md
references:
  - kind: lines
    path: docs/PRD.md
    range: [506, 506]
    contentHash: TBD-on-commit
    note: "PRD §6 — MVP roster: tech-lead drafts the plan/RFC for any non-trivial change and owns the ADR."
  - kind: lines
    path: docs/PRD.md
    range: [649, 658]
    contentHash: TBD-on-commit
    note: "PRD §7 — feature-delivery `plan` stage YAML declaring `/src/work/<day>/<id>/adr-draft.md` as a required output of the plan stage."
  - kind: lines
    path: docs/PRD.md
    range: [915, 915]
    contentHash: TBD-on-commit
    note: "PRD §8 — Memory architecture: `/src/memory/adr/` holds immutable architecture decision records in Nygard format."
  - kind: lines
    path: docs/PRD.md
    range: [1004, 1010]
    contentHash: TBD-on-commit
    note: "PRD §8 — Anti-rot: dual-anchor citations on every ADR/RFC/PRD, ADR immutability, supersession via a new ADR with `supersedes:` link."
---

# Skill — `write-adr`

A reusable 6-step procedure for authoring one Architecture Decision Record. The
canonical callers are `src/personas/tech-lead.md` (drafts the ADR at the `plan`
stage), `src/personas/reviewer.md` (drafts a corrective ADR when the `review`
stage uncovers an undocumented decision), and `src/personas/librarian.md` (drafts
an ADR when the `knowledge-curation` cron pipeline finds a stale or missing
record). M2+ adds `groomer` and M3+ adds `appsec` as additional callers.

## Prerequisites

- `/src/memory/adr/` SHALL exist and contain the prior ADR sequence; the next ADR
  sequence number is `max(seq) + 1` zero-padded to 4 digits.
- `/src/memory/handbook/glossary.md` SHALL exist; every domain noun in the ADR
  body resolves through this file.
- `/src/memory/handbook/contract-style.md` SHALL exist; the ADR body satisfies
  Layer 1 lint per PRD §4.6.
- The decision under record SHALL be captured in an inbox item, a `plan.md`,
  or a `review.md`. Authoring an ADR without a triggering artifact MUST halt
  and route via inbox.

## The 6-step authoring loop

Execute these steps in order, once per ADR. Do not skip ahead.

### Step 1 — Allocate the sequence number and the slug

Read `/src/memory/adr/` and pick `<seq> = max(existing seq) + 1`, zero-padded to
4 digits. The slug MUST be lowercase-kebab-case at most 6 words, drawn from
the decision title. The full filename is
`/src/memory/adr/<seq>-<slug>.md`. When the ADR drafts under a Feature, the
`plan` stage MUST also stage `/src/work/<day>/<id>/adr-draft.md` per PRD §7
lines 655 through 658; the file copies forward into `/src/memory/adr/` only on
human ratification.

### Step 2 — Fill the Nygard frontmatter

Every ADR MUST carry a YAML frontmatter block with the keys below. Missing
keys fail the gate.

```yaml
---
title: <one-line decision title>
seq: <zero-padded 4-digit sequence>
status: proposed              # proposed | accepted | superseded | deprecated | rejected
date: <ISO-8601 date>
deciders: [<persona-or-human-handle>, ...]
supersedes: <prior-ADR seq, or null>
superseded-by: <future-ADR seq, or null>
references:
  - kind: <symbol|lines>
    path: <repo-relative path>
    symbol: <symbol name when kind is symbol>
    range: <[start, end] when kind is lines>
    contentHash: TBD-on-commit
    note: <one-sentence summary of the cited content>
---
```

The `status` field MUST start at `proposed` and SHALL transition to
`accepted` only after human ratification through inbox per AGENTS.md §5
bullet 2. Supersession routes through a new ADR with the prior `seq` listed
in `supersedes:` per PRD §8 line 1010; you MUST NOT edit a prior ADR's body.

### Step 3 — Author the four-section body

The ADR body MUST contain exactly four `##` sections in this order:

1. **Context.** One to three paragraphs naming the forces that motivate the
   decision: business pressure, technical constraints, prior ADRs, and the
   alternatives under live consideration. Every external claim MUST carry a
   dual-anchor citation per PRD §8.
2. **Decision.** One paragraph at most 80 words stating the chosen option in
   the active voice with one RFC 2119 obligation keyword. The decision MUST
   resolve every open question listed in the Context.
3. **Status.** One sentence stating the current `status` and the date it
   entered that status; supersession history MUST cite the prior ADR via
   dual-anchor citation per PRD §8.
4. **Consequences.** A bulleted list grouping outcomes under three headings:
   `positive`, `negative`, and `neutral`. Each bullet MUST be at most one
   sentence; quantified claims MUST carry units.

The full body MUST stay at most 1000 words across the four sections combined.

### Step 4 — Wire dual-anchor citations and the supersession chain

Every external claim MUST resolve to a dual-anchor citation per PRD §8 lines
1004 through 1010. Prefer `{kind: 'symbol', path, symbol, contentHash}` for
code references; fall back to `{kind: 'lines', path, range, contentHash}`
only for non-AST content.

When the ADR supersedes a prior decision, you MUST set `supersedes:` to the
prior ADR's `seq`, and you MUST set the prior ADR's `superseded-by:` to the
new ADR's `seq` in a follow-up Librarian-curated update; you MUST NOT edit
the prior ADR's body.

### Step 5 — Run Layer 1 lint against the body

Apply the Layer 1 lint discipline declared in
`/src/memory/handbook/contract-style.md` to every normative clause in the ADR
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

### Step 6 — Stage the file and route the ratification ask

When all gates are green, you MUST:

1. Stage the new file at `/src/memory/adr/<seq>-<slug>.md` with `status:
   proposed`. You MUST NOT commit; you MUST NOT push.
2. When the ADR drafts under the `feature-delivery` `plan` stage, also stage
   `/src/work/<day>/<id>/adr-draft.md` for the downstream `implement` and `review`
   stages per PRD §7 lines 655 through 658.
3. Open one inbox item at `src/inbox/in/<timestamp>-adr-<seq>-ratification.md`
   summarizing the decision, the alternatives rejected, and any open
   questions. The supervisor flips `status` to `accepted` only after the
   human ratifies the inbox item.
4. When the new ADR supersedes a prior ADR, schedule the prior ADR's
   `superseded-by:` update through the `librarian` post_run hook; do NOT
   edit the prior ADR yourself.
5. Register the new ADR in `/src/memory/features/<id>/index.json` when the ADR
   was authored under a Feature; the `librarian` runs the registration on
   the next post_run sweep.

## Stop conditions

- Halt when the triggering artifact (inbox item, `plan.md`, `review.md`) is
  missing; do NOT invent a decision.
- Halt when the proposed decision overlaps an `accepted` ADR by more than
  50% of its scope; either supersede the prior ADR or merge.
- Halt when the prior ADR's `superseded-by:` field is already set; the chain
  MUST stay linear.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.
- Halt when any dual-anchor citation reports `gone` per the content-hash
  verifier; refresh the anchor or open an inbox item.

## Cost guards

- Per-ADR draft default `max_tokens: 8000`. ADR bodies above 1000 words MUST
  trip a hard halt; long-form decisions route through `write-rfc` instead.
- The supersession chain MUST stay linear; loops or branches fail the gate.
