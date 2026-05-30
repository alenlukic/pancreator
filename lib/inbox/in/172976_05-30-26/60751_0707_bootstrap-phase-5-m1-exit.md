---
title: "Bootstrap Phase 5 M1 Exit — close docs/BOOTSTRAP.md"
feature_id: "bootstrap-phase-5-m1-exit"
stage: intake
owner: "intake-analyst"
status: open
created_at: "2026-05-30T07:07:28.454Z"
references:
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 5 "Rest of M1" exit gate and cross-cutting Phase-5 stabilization obligations.
  - kind: path
    path: docs/M1.index.md
    note: Compact M1 routing and explicit statement that phase number alone does not prove M1 completion.
  - kind: path
    path: pancreator.yaml
    note: Live bootstrap tracker currently set to phase 5 in progress with Phase 4 ratified and Phoenix trace verification deferred.
  - kind: path
    path: AGENTS.md
    note: Canonical inbox queue, human phase-boundary ratification, and non-negotiable stage exit criteria.
  - kind: path
    path: lib/pipelines/init-greenfield.yaml
    note: Greenfield pipeline stages the US-9 kit must support.
  - kind: path
    path: lib/pipelines/adopt.yaml
    note: Adopt pipeline stages the US-9 kit must support.
  - kind: path
    path: lib/personas/adopter.md
    note: Adopter persona owns scan/ratify setup the kit must scaffold.
  - kind: path
    path: docs/PRD.md
    note: PRD section 11 MVP scope definition and completion expectations required for M1 closure.
---

# Bootstrap Phase 5 M1 Exit — close docs/BOOTSTRAP.md

## Problem

The repository remains in `bootstrap.status: phase-5-in-progress`, so
`docs/BOOTSTRAP.md` still carries active authority for unresolved M1 delivery
work. This creates a persistent bootstrap-open state where operators cannot
ratify M1 completion or confidently transition to M2 planning.

The remaining gap is not Phase 4 proof, which was ratified on 2026-05-19. The
remaining gap is Phase 5 hardening and baseline closure: US-9 install-path
evidence, knowledge-curation anti-rot wiring, KPI baseline evidence, and
documentation/state ratification updates.

The prior US-9 framing required hardening `init-greenfield` and `adopt` across
three unrelated target classes before any real run — that is overengineered.
One fairly complex monorepo is sufficient; the operator has a candidate. For
**this feature**, US-9 work (R1) SHALL deliver the evidence-gathering kit, not
execute the run. A small follow-on inbox item SHALL become the final bootstrap
gate for running the kit against that candidate.

## Goal

Close the Bootstrap Phase 5 gate and ratify M1 completion by delivering all
remaining mandatory M1 work packages, recording KPI baseline results in
`lib/memory/adr/0002-m1-baseline.md`, and updating canonical tracking documents
so `docs/BOOTSTRAP.md` is no longer an open-work ledger.

For US-9 specifically: R1 delivers the kit; the follow-on task runs it on the
candidate monorepo and supplies evaluable proof for M1 ratification.

## Non-goals

This directive SHALL NOT run M2 implementation work.

This directive SHALL NOT reopen ratified Phase 4 US-1 evidence.

This directive SHALL NOT execute greenfield or adopt against the candidate
monorepo within this feature (that is the follow-on bootstrap-gate task).

This directive SHALL NOT require multi-target US-9 sweeps (Python service,
Next.js app, additional TS repos) for bootstrap closure; one complex monorepo
is sufficient. Additional targets MAY land in M2 backlog.

This directive SHALL NOT block M1 exit solely on Phoenix/Langfuse external
trace verification if the current ratified deferral remains documented and
linked to engineering backlog ownership.

## Required outcomes

### R1 — US-9 evidence-gathering kit (`init-greenfield` + `adopt`)

The delivery pipeline SHALL produce a kit with these components. This satisfies
the acceptance bar for US-9 **within this feature**; the live run against the
candidate monorepo is deferred to the follow-on bootstrap-gate task.

1. **Adopter / greenfield agent setup** — any updates or scaffolding required so
   `adopter` and the greenfield stages can run against an external monorepo with
   clear operator steps (paths, env, CLI verbs, prompts, or skill packs as
   needed). The setup MUST be documented in-repo, not tribal knowledge.

2. **Greenfield evidence artifact contract** — a defined artifact shape the agent
   SHALL emit after greenfielding the target repo. The contract MUST specify
   required fields, file location convention, and what "success" means so
   evaluators in this repo can judge the run without opening the target repo.

3. **In-repo evaluation path** — a checker, compliance descriptor, or documented
   procedure in this repository that consumes the artifact and produces a
   pass/fail (or pass/fail-with-gaps) verdict evaluable from CI or librarian
   pre-close validation.

4. **Follow-on inbox stub** — a ready-to-promote draft for the final
   bootstrap-gate directive that references the kit, names the candidate monorepo
   slot (operator fills path), and lists acceptance criteria for the actual run.

Primary stages/owners: `intake-analyst` -> `tech-lead` -> `coder` ->
`reviewer` -> `tech-writer` -> `librarian`.

### R3 — Deliver `knowledge-curation` cron seed and anti-rot loop

`knowledge-curation` SHALL have a ratified cron-seed path and a Librarian-owned
anti-rot loop with clear trigger cadence, artifact destinations, and operator
handoff expectations.

Primary stages/owners: `tech-lead`, `coder`, `librarian`, `tech-writer`.

### R4 — Baseline M1 KPI bank and record residual gaps

The run SHALL baseline KPI ranges A1-A18 and A22-A27 against current repository
state, record pass/fail/unknown outcomes, and document residual gaps plus owner
routing in a new ADR at `lib/memory/adr/0002-m1-baseline.md`.

Primary stages/owners: `tech-lead`, `reviewer`, `tech-writer`, `librarian`.

### R5 — Review handbook seed stability flags (BR5 cross-cutting)

All handbook seeds still marked `stability: experimental` from bootstrap
onboarding SHALL be reviewed. Each reviewed item MUST be promoted to `stable` or
explicitly retained as `experimental` with documented rationale and a backlog
link.

Primary stages/owners: `tech-lead`, `reviewer`, `librarian`.

### R6 — Ratify bootstrap state transition artifacts

After R1 and R3-R5 are complete and accepted, and after the follow-on US-9 run
succeeds, the repository SHALL update canonical phase tracking to reflect M1
completion readiness:

- `pancreator.yaml` bootstrap status/notes/evidence;
- `docs/M1.index.md` state wording as needed;
- `AGENTS.md` bootstrap-status wording as needed; and
- any operator-facing readme/index pointers that still imply open Phase 5 work.

Primary stages/owners: `tech-writer`, `librarian`, `reviewer`, human ratifier.

### R7 — Scope Phoenix/Langfuse trace verification correctly

Phoenix/Langfuse external trace verification SHALL remain backlog-deferred under
`@pancreator/run-logger` + `pancreator-engineer` ownership unless a newly
discovered blocker proves it is required for PRD section 11 M1 closure.

If a blocker is found, the blocker MUST be documented with explicit causal
evidence and elevated for human ratification before M1 closure is denied.

## Required execution

1. Intake SHALL produce a feature spec and touch-set that decomposes R1 and
   R3-R7 into ordered work packages with explicit stage owners and ratification
   gates.
2. `feature-delivery` SHALL execute each package with stage-boundary artifacts
   preserved and indexable.
3. R1 (kit) SHOULD complete before the follow-on US-9 bootstrap-gate task is
   promoted; R3-R5 MAY proceed in parallel where dependencies allow.
4. The ADR at `lib/memory/adr/0002-m1-baseline.md` MUST be authored before final
   M1 ratification request output.
5. Documentation-impact review SHALL run after each package; unresolved doc
   updates MUST be backlog-linked with owner and rationale.
6. Final ratification packet SHALL include M1 closure claim, residual-risk list,
   and explicit recommendation: "close BOOTSTRAP M1 gate now" or "hold with
   blockers." M1 closure SHALL remain blocked until the follow-on US-9 run
   produces a passing in-repo evaluation verdict.

## Acceptance criteria

### R1 — US-9 kit (this feature)

1. Adopter/greenfield agent setup is documented with copy-paste operator steps.
2. A greenfield evidence artifact contract is defined (schema, location, success
   criteria).
3. An in-repo evaluation path exists and is runnable against a fixture or sample
   artifact without the external monorepo.
4. A follow-on bootstrap-gate inbox item is drafted and references the kit
   artifacts and evaluation procedure.

### R3-R7 and overall closure

5. A canonical feature spec exists for `bootstrap-phase-5-m1-exit` with ordered
   work packages covering R1 and R3-R7.
6. `knowledge-curation` cron-seed workflow is implemented and documented.
7. Librarian anti-rot loop behavior is implemented (or explicitly deferred with
   owner, rationale, and backlog linkage).
8. `lib/memory/adr/0002-m1-baseline.md` exists and records KPI A1-A18 + A22-A27
   baseline status plus gaps and owners.
9. PRD section 11 MVP scope closure status is explicitly mapped in the final
   report (done vs gap per scope line).
10. CI conformance-suite status is reported, with any failures tied to specific
    blockers and owners.
11. Handbook seed stability review is completed with promotion decisions or
    justified deferrals.
12. `pancreator.yaml` is updated to reflect post-Phase-5 ratification intent and
    evidence links.
13. `docs/M1.index.md` and `AGENTS.md` no longer imply unresolved Phase 5 M1
    bootstrap work once ratified.
14. Phoenix/Langfuse trace verification deferral is explicitly referenced with
    backlog ownership, and is not treated as an implicit blocker absent new
    contrary evidence.
15. Human ratification request is prepared with a complete artifact bundle and a
    clear go/no-go recommendation for M1 closure.
16. Follow-on US-9 bootstrap-gate run (outside this feature) has produced a
    passing in-repo evaluation verdict against the candidate monorepo artifact
    before M1 is declared complete.

## Manual validation requested from operator

### R1 kit (before promoting follow-on)

1. Walk the documented agent setup steps and confirm they are complete enough to
   run against the candidate monorepo without guessing.
2. Inspect the greenfield evidence artifact contract and confirm required fields
   are unambiguous.
3. Run the in-repo evaluator against the provided fixture/sample and confirm it
   produces a clear verdict.
4. Review the follow-on bootstrap-gate inbox draft and confirm it is ready to
   promote after kit acceptance.

### M1 closure (after R3-R7 and follow-on US-9 run)

5. Read the final delivery report and confirm it explicitly claims whether M1 is
   complete under PRD section 11 scope.
6. Inspect the artifact from the follow-on US-9 run on the candidate monorepo
   and confirm the in-repo evaluator passes.
7. Verify `lib/memory/adr/0002-m1-baseline.md` exists and contains KPI A1-A18 +
   A22-A27 baseline outcomes and owner-tagged gaps.
8. Verify the `knowledge-curation` cron seed and anti-rot loop outputs are
   documented with clear run/ownership expectations.
9. Verify handbook stability-promotion decisions are recorded for experimental
   seeds and that unresolved items have backlog links.
10. Confirm `pancreator.yaml`, `docs/M1.index.md`, and `AGENTS.md` are coherent
    with the proposed M1-complete state.
11. Confirm Phoenix/Langfuse trace verification treatment matches the ratified
    deferral policy unless new blocker evidence is presented.
12. Confirm CI conformance result is green, or explicitly ratify any documented
    exception path with owner and timeline.
13. Ratify Phase 5/M1 closure or record a blocker list with exact reopen actions.

## Out of scope

- Executing greenfield or adopt on the candidate monorepo within this feature
  (follow-on bootstrap-gate task).
- Multi-target US-9 sweeps beyond one complex monorepo.
- Running `pan run feature-delivery` as part of intake creation.
- Committing, pushing, or release operations.
- M2 pipeline additions or multi-repo expansion.
- Re-litigating ratified Phase 4 evidence unless contradictory evidence is found.
