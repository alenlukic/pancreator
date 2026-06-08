---
title: "Bootstrap Phase 5 M1 Exit — close .docs/BOOTSTRAP.md"
feature_id: bootstrap-phase-5-m1-exit-close-docs-bootstrap
status: implement-staged
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  channel: operator_cursor_chat
  note: |
    The intake-analyst opts out of the clarifying-question loop because the
    source directive enumerates six required-outcome sections (R1 and R3-R7),
    sixteen acceptance criteria, thirteen operator manual-validation steps,
    and six explicit non-goals. No material ambiguity blocks canonicalization.
    The directive grants two scoping decisions to the plan stage: the exact
    touch-set for the knowledge-curation cron seed (R3) and the concrete ADR
    format for the KPI baseline (R4). These choices route to the plan stage
    as declared decision slots, not open intake questions.
references:
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
    range: [1, 33]
    contentHash: 7dafd8f
    note: "Source directive frontmatter declares feature id, intake owner, status, created timestamp, and the eight reference paths."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
    range: [37, 54]
    contentHash: 7dafd8f
    note: "Source directive problem statement and goal: Phase 5 gap is US-9 install-path evidence, knowledge-curation anti-rot wiring, KPI baseline, and documentation/state ratification updates."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
    range: [67, 82]
    contentHash: 7dafd8f
    note: "Source directive non-goals enumerate six SHALL NOT constraints covering M2 work, Phase 4 evidence, live US-9 run, multi-target sweeps, and Phoenix-trace blocking."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
    range: [84, 176]
    contentHash: 7dafd8f
    note: "Source directive required outcomes R1 and R3-R7 with primary stage owner chains and required execution order."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md
    range: [178, 260]
    contentHash: 7dafd8f
    note: "Source directive acceptance criteria grouped by R1 (criteria 1-4) and R3-R7 plus overall closure (criteria 5-16)."
  - kind: lines
    path: .docs/BOOTSTRAP.md
    range: [250, 267]
    contentHash: b788753
    note: "BOOTSTRAP Phase 5 section lists the three deliverable clusters (US-9 pipelines, knowledge-curation, KPI baseline ADR) and declares the M1 exit criterion: PRD section 11 closed, CI green, KPIs baselined."
  - kind: lines
    path: .docs/BOOTSTRAP.md
    range: [269, 287]
    contentHash: b788753
    note: "BOOTSTRAP cross-cutting conventions: non-negotiable phase exit criteria, dual-anchor citations, commit trailers, human in-loop at every phase boundary, BR5 handbook seed stability review."
  - kind: lines
    path: .docs/M1.index.md
    range: [18, 40]
    contentHash: 7b1e138
    note: "M1 index records bootstrap.phase 5, status phase-5-in-progress, current focus, and the token-economy rule requiring BOOTSTRAP.md only for phase-exit detail."
  - kind: lines
    path: AGENTS.md
    range: [263, 291]
    contentHash: b953d77
    note: "AGENTS bootstrap-status section: Phase 5 in progress, Phase 4 ratified 2026-05-19, Phoenix trace verification deferred under @pancreator/run-logger and pancreator-engineer backlog."
  - kind: lines
    path: AGENTS.md
    range: [141, 148]
    contentHash: b953d77
    note: "AGENTS working-agreement: operator-sandbox exclusion of lib/inbox/notes/, human in-loop at every phase boundary, documentation-impact check mandatory per task."
  - kind: lines
    path: .docs/PRD.md
    range: [207, 224]
    contentHash: 2eb6aa4
    note: "PRD section 3.5 US-9: two MVP install paths (greenfield and existing-repo), adopter persona, adopt sub-pipeline, non-destructive first-run, and no-conflict guarantees."
  - kind: lines
    path: .docs/PRD.md
    range: [1107, 1125]
    contentHash: 2eb6aa4
    note: "PRD section 11 MVP scope: install-path proof via pan create-pancreator and pan init, knowledge-curation pipeline, KPI baseline, and all package implementations required for M1 closure."
  - kind: symbol
    path: lib/pipelines/init-greenfield.yaml
    contentHash: 29e3bb5
    note: "Greenfield pipeline definition: stages the US-9 kit must support for evidence-gathering."
  - kind: symbol
    path: lib/pipelines/adopt.yaml
    contentHash: 2d8426b
    note: "Adopt pipeline definition: stages the US-9 kit must support for existing-repo evidence-gathering."
  - kind: symbol
    path: lib/personas/adopter.md
    contentHash: 9bf9624
    note: "Adopter persona: owns scan and ratify setup that the US-9 kit must scaffold."
---

# Spec

This Feature SHALL close the Bootstrap Phase 5 gate and prepare the M1
completion ratification request per the Phase 5 exit criterion at
`{kind: lines, path: .docs/BOOTSTRAP.md, range: [265, 266], contentHash: b788753}`.

This Feature SHALL deliver six work packages (WP1 through WP6) that
collectively satisfy the required outcomes R1 and R3-R7 from the source
directive at
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [84, 176], contentHash: b788753}`.

This Feature SHALL execute each work package through the `feature-delivery`
Pipeline with stage-boundary artifacts preserved and indexable.

This Feature SHALL preserve every Persona, Skill, Pipeline, documentation-impact,
policy-compliance, inbox-lifecycle, and stage-exit obligation cited at
`{kind: lines, path: AGENTS.md, range: [141, 148], contentHash: b953d77}`.

This Feature SHALL NOT start M2 implementation work, SHALL NOT reopen ratified
Phase 4 US-1 evidence, SHALL NOT execute greenfield or adopt against the
candidate monorepo within this feature, and SHALL NOT require multi-target
US-9 sweeps per the non-goals at
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [67, 82], contentHash: 7dafd8f}`.

## Work packages

The following work packages decompose R1 and R3-R7 into ordered units with
explicit stage owners and ratification gates. WP1 (R1) SHOULD complete before
the follow-on US-9 bootstrap-gate task is promoted. WP2 through WP5 MAY
proceed in parallel where dependencies allow. WP6 (R7) SHOULD execute as a
first-pass gate-check within WP1.

---

### WP1 — US-9 evidence-gathering kit (R1)

**Stage chain:** `intake-analyst` → `tech-lead` → `coder` → `reviewer` →
`tech-writer` → `librarian`

**Ratification gate:** human validation of the kit before promoting the follow-on
bootstrap-gate inbox item.

This work package SHALL deliver four artifacts that together satisfy the
acceptance bar for US-9 within this Feature per
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [84, 112], contentHash: 7dafd8f}`.

WP1.1 — **Adopter and greenfield agent setup.** When the coder executes WP1.1,
the coder SHALL produce in-repo documentation with copy-paste operator steps
that allow the `adopter` persona and the `init-greenfield` pipeline stages to
run against an external monorepo. The documentation MUST cover required paths,
environment variables, CLI verbs, prompts, and skill-pack configuration. The
documentation SHALL NOT rely on tribal knowledge outside the repository.

WP1.2 — **Greenfield evidence artifact contract.** When the tech-lead plans
WP1.2, the tech-lead SHALL define an artifact schema specifying required fields,
file location convention, and the success criterion that in-repo evaluators use
to judge a run without opening the target repository. The schema SHALL live under
`lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/`.

WP1.3 — **In-repo evaluation path.** When the coder implements WP1.3, the coder
SHALL deliver a checker, compliance descriptor, or documented procedure that
consumes a greenfield evidence artifact and produces a pass, fail, or
fail-with-gaps verdict. The evaluation path MUST be runnable against a fixture
or sample artifact without the external monorepo present. The evaluation path
MUST be invocable from CI or from the librarian pre-close validation step.

WP1.4 — **Follow-on bootstrap-gate inbox stub.** When the tech-writer executes
WP1.4, the tech-writer SHALL draft a ready-to-promote inbox item under
`lib/inbox/in/` that references the kit artifacts and the in-repo evaluation
procedure, names the candidate monorepo slot (operator fills the path), and
lists the acceptance criteria for the actual US-9 run. The draft SHALL NOT be
promoted to the active queue within this Feature.

---

### WP2 — knowledge-curation cron seed and anti-rot loop (R3)

**Stage chain:** `tech-lead` → `coder` → `librarian` → `tech-writer`

**Ratification gate:** human validation that the cron-seed path is runnable and
the anti-rot loop has clear operator handoff expectations.

This work package SHALL deliver the `knowledge-curation` cron-seed path and a
Librarian-owned anti-rot loop per
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [113, 119], contentHash: 7dafd8f}`.

WP2.1 — When the tech-lead plans WP2.1, the tech-lead SHALL ratify the
cron-seed trigger cadence, the artifact destinations, and the operator handoff
expectations for the anti-rot loop. The plan SHALL cite the relevant Pipeline
definition at `{kind: symbol, path: lib/pipelines/init-greenfield.yaml, contentHash: 29e3bb5}`.

WP2.2 — When the coder implements WP2.2, the coder SHALL implement or wire the
cron-seed path so the `knowledge-curation` Pipeline can be triggered by operator
invocation. The implementation SHALL document the trigger cadence and the output
artifact location.

WP2.3 — When the librarian executes WP2.3, the librarian SHALL verify that the
anti-rot loop behavior is implemented or SHALL record an explicit deferral with
owner, rationale, and a backlog link if implementation is deferred.

---

### WP3 — Baseline M1 KPI bank and record residual gaps (R4)

**Stage chain:** `tech-lead` → `reviewer` → `tech-writer` → `librarian`

**Ratification gate:** human validation that the ADR exists and records KPI
outcomes plus owner-tagged gaps before final ratification request.

This work package SHALL baseline KPI ranges A1-A18 and A22-A27 against the
current repository state and record outcomes in a new ADR per
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [121, 127], contentHash: 7dafd8f}`.

WP3.1 — When the tech-lead executes WP3.1, the tech-lead SHALL run the KPI
evaluation and record pass, fail, or unknown outcomes for each KPI in A1-A18
and A22-A27 against the current repository state.

WP3.2 — When the tech-writer executes WP3.2, the tech-writer SHALL author the
ADR at `lib/memory/adr/0002-m1-baseline.md` that records every KPI outcome,
every residual gap, and the owner and routing for each gap. The ADR MUST exist
before the final M1 ratification request is emitted.

---

### WP4 — Review handbook seed stability flags (R5, BR5)

**Stage chain:** `tech-lead` → `reviewer` → `librarian`

**Ratification gate:** human validation that every experimental handbook seed
has been promoted or has a documented rationale and backlog link.

This work package SHALL review all handbook seeds still marked
`stability: experimental` per the BR5 cross-cutting obligation at
`{kind: lines, path: .docs/BOOTSTRAP.md, range: [307, 311], contentHash: b788753}`.

WP4.1 — When the tech-lead executes WP4.1, the tech-lead SHALL enumerate every
handbook seed under `lib/memory/handbook/` that carries `stability: experimental`
and SHALL produce a promotion decision (stable or explicitly retained experimental)
for each item.

WP4.2 — When an item is retained as experimental, the tech-lead SHALL document
the rationale and a backlog link in the same file that carries the stability flag.

WP4.3 — When the reviewer executes WP4.3, the reviewer SHALL confirm every
reviewed item has either received a `stability: stable` promotion or carries
the documented rationale and backlog link from WP4.2.

---

### WP5 — Ratify bootstrap state transition artifacts (R6)

**Stage chain:** `tech-writer` → `librarian` → `reviewer` → human ratifier

**Ratification gate:** human ratification of the M1 completion state after WP1-WP4
are accepted and after the follow-on US-9 run succeeds.

This work package SHALL update the canonical phase tracking documents to reflect
M1 completion readiness per
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [138, 149], contentHash: 7dafd8f}`.

WP5.1 — When the tech-writer executes WP5.1, the tech-writer SHALL update
`pancreator.yaml` bootstrap status, notes, and evidence to reflect the
post-Phase-5 ratification intent and evidence links.

WP5.2 — When the tech-writer executes WP5.2, the tech-writer SHALL update
`.docs/M1.index.md` state wording if the current wording implies unresolved
Phase 5 M1 work.

WP5.3 — When the tech-writer executes WP5.3, the tech-writer SHALL update
`AGENTS.md` bootstrap-status wording if the current wording implies unresolved
Phase 5 M1 work.

WP5.4 — When the librarian executes WP5.4, the librarian SHALL update any
operator-facing readme or index pointer that still implies open Phase 5 work.

WP5.5 — When the reviewer executes WP5.5, the reviewer SHALL confirm every
document in WP5.1-WP5.4 is coherent with the proposed M1-complete state.

This work package SHALL NOT proceed until WP1-WP4 are accepted and the
follow-on US-9 run produces a passing in-repo evaluation verdict.

---

### WP6 — Scope Phoenix/Langfuse trace verification (R7)

**Stage chain:** `tech-lead` (gate-check within WP1 plan), `reviewer`

**Ratification gate:** reviewer sign-off that the deferral treatment is explicit
and correctly linked to the ratified deferral policy.

This work package SHALL confirm that Phoenix/Langfuse external trace verification
remains backlog-deferred under `@pancreator/run-logger` and `pancreator-engineer`
ownership unless a newly discovered blocker proves it is required for PRD
section 11 M1 closure per
`{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [151, 159], contentHash: 7dafd8f}`.

WP6.1 — When the tech-lead executes WP6.1, the tech-lead SHALL confirm the
existing deferral is documented with backlog ownership and SHALL produce no
additional work items unless a blocker is found.

WP6.2 — When a blocker is found in WP6.1, the tech-lead SHALL document the
blocker with explicit causal evidence and SHALL elevate it for human ratification
before M1 closure proceeds.

WP6.3 — When the reviewer executes WP6.3, the reviewer SHALL confirm the Phoenix
trace verification treatment matches the ratified deferral policy at
`{kind: lines, path: AGENTS.md, range: [263, 291], contentHash: b953d77}`.

---

## Acceptance criteria

### WP1 — US-9 kit acceptance criteria

- When WP1.1 is delivered, the adopter and greenfield agent setup documentation
  MUST include copy-paste operator steps that are complete enough to run against
  the candidate monorepo without consulting any source outside the repository.
- When WP1.2 is delivered, the greenfield evidence artifact contract MUST specify
  required fields, file location convention, and the success criterion in
  unambiguous terms.
- When WP1.3 is delivered, the in-repo evaluation path MUST produce a clear
  pass, fail, or fail-with-gaps verdict when run against the provided fixture or
  sample artifact without the external monorepo.
- When WP1.4 is delivered, the follow-on bootstrap-gate inbox draft MUST reference
  the kit artifacts and the evaluation procedure, name the candidate monorepo slot,
  and list acceptance criteria for the actual run.

### WP2 — knowledge-curation acceptance criteria

- When WP2 is delivered, a canonical `knowledge-curation` cron-seed workflow
  MUST be implemented and documented with trigger cadence and output artifact
  location.
- When WP2 is delivered, the Librarian anti-rot loop MUST be implemented with
  clear run and ownership expectations, or MUST be explicitly deferred with owner,
  rationale, and backlog linkage.

### WP3 — KPI baseline acceptance criteria

- When WP3 is delivered, `lib/memory/adr/0002-m1-baseline.md` MUST exist and
  MUST record pass, fail, or unknown outcomes for KPI A1-A18 and A22-A27 against
  the current repository state.
- When WP3 is delivered, the ADR MUST document every residual gap with owner
  routing and an explicit remediation path.

### WP4 — Handbook seed stability acceptance criteria

- When WP4 is delivered, every handbook seed under `lib/memory/handbook/` that
  previously carried `stability: experimental` MUST carry either `stability: stable`
  or a documented rationale plus a backlog link.

### WP5 — State transition acceptance criteria

- When WP5 is delivered, `pancreator.yaml` MUST reflect post-Phase-5 ratification
  intent with evidence links.
- When WP5 is delivered, `.docs/M1.index.md` and `AGENTS.md` MUST NOT imply
  unresolved Phase 5 M1 bootstrap work.
- When WP5 is delivered, every operator-facing pointer that previously implied
  open Phase 5 work MUST be updated or MUST carry an explicit deferral note.

### WP6 — Phoenix trace verification acceptance criteria

- When WP6 is delivered, the Phoenix/Langfuse trace verification deferral MUST be
  explicitly referenced with backlog ownership, and MUST NOT be treated as an
  implicit blocker absent new contrary evidence.
- When the reviewer executes WP6.3, the reviewer MUST either confirm the deferral
  treatment matches the ratified policy or MUST escalate a documented blocker for
  human ratification before M1 closure proceeds.

### Overall M1 closure acceptance criteria

- When the final delivery report is produced, the report MUST map every PRD
  section 11 MVP scope item to one of: done, gap with owner, or explicitly
  deferred per `{kind: lines, path: .docs/PRD.md, range: [1107, 1125], contentHash: 2eb6aa4}`.
- When the final delivery report is produced, the CI conformance-suite status MUST
  be reported, with any failures tied to specific blockers and owners.
- When the human ratification request is prepared, the request MUST include a
  complete artifact bundle and a clear go/no-go recommendation for M1 closure.
- When M1 completion is declared, the follow-on US-9 bootstrap-gate run MUST have
  produced a passing in-repo evaluation verdict against the candidate monorepo
  artifact before M1 is declared complete.

### Stage and policy invariants

- When this Feature stages any structural change outside `.pan/work/`, the Feature MUST
  stage one `.pan/work/<day>/<task-id>/policy-compliance.json` per the policy-compliance
  contract cited at `{kind: lines, path: AGENTS.md, range: [178, 184], contentHash: b953d77}`.
- When this Feature completes any work package, the documentation-impact decision
  MUST be recorded as applied updates or as deferred items with backlog linkage per
  `{kind: lines, path: AGENTS.md, range: [158, 161], contentHash: b953d77}`.
- When this Feature reads, traverses, or cites repository content, the Feature MUST
  NOT touch any path under `lib/inbox/notes/` per the operator-sandbox rule at
  `{kind: lines, path: AGENTS.md, range: [141, 148], contentHash: b953d77}`.
- When this Feature touches Persona specs, Skill packs, Pipeline definitions,
  testing infrastructure, or milestone ratification artifacts, the Feature MUST
  trigger one compliance-run pass per the AGENTS section 6.1 obligation.

## Out of scope

- This Feature SHALL NOT execute greenfield or adopt on the candidate monorepo
  within this feature per
  `{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [251, 260], contentHash: 7dafd8f}`.
- This Feature SHALL NOT require multi-target US-9 sweeps beyond one complex
  monorepo for bootstrap closure per the same non-goals range.
- This Feature SHALL NOT start M2 pipeline additions or multi-repo expansion.
- This Feature SHALL NOT reopen ratified Phase 4 US-1 evidence unless contradictory
  evidence is found.
- This Feature SHALL NOT run `pan run feature-delivery` as part of intake creation.
- This Feature SHALL NOT commit, push, or perform release operations.
- This Feature SHALL NOT block M1 exit solely on Phoenix/Langfuse external trace
  verification when the current ratified deferral is documented and linked to
  engineering backlog ownership per
  `{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [78, 82], contentHash: 7dafd8f}`.
- This Feature SHALL NOT modify Persona role semantics, authority boundaries,
  tool grants, or safety constraints; persona changes route through
  `persona-designer` per the AGENTS section 3 self-protection rule.

## Plan-stage decisions required

The intake stage delegates the implementation choices below to the `tech-lead`
plan stage.

- D1. Choose the exact touch-set for the `knowledge-curation` cron-seed
  implementation (WP2): whether it lands as a new Pipeline YAML, a skill-pack
  addition, a coder implementation patch, or a documented operator-manual
  procedure. The choice MUST satisfy the R3 acceptance criterion that the trigger
  cadence and artifact destinations are unambiguous.
- D2. Choose the KPI evaluation methodology for WP3: whether to use the existing
  compliance descriptors under `tests/compliance/`, a new `pan` CLI sub-command,
  or a documented hand-evaluation procedure. The choice MUST produce reproducible
  outcomes for every KPI in A1-A18 and A22-A27.
- D3. Choose the greenfield evidence artifact schema for WP1.2: field names,
  data types, file naming convention, and the exact success criterion threshold.
  The schema MUST allow a pass/fail verdict without the external monorepo present.
- D4. Choose the ordering of WP2, WP3, WP4 in the plan-stage touch-set when
  dependencies allow parallel execution. WP1 MUST complete first per the source
  directive at `{kind: lines, path: lib/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md, range: [162, 168], contentHash: 7dafd8f}`.

## Open questions

- None.
