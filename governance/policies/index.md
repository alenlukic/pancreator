# Policy catalog

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Policies MUST be small, globally identified JSON modules. `governance/registries/policy_lookup_table.json` MUST select policies by persona, workflow, stage, optional detected workspace `technology`, and optional active run `contract`. The harness MUST union all matching rows and snapshot the resulting policies into each invocation card. Technology-scoped rows MUST activate only when the resolved target workspace contains the corresponding declared markers or source files. A policy that depends on durable static guidance MUST declare it through `guidance_sources`; the resolver MUST snapshot the selected guidance content into the invocation rather than require the worker to open the source file.

- `GLOBAL-001` — operator-first records
- `GLOBAL-002` — bounded context retrieval
- `BRIEF-001` — semantic HTML operator brief structure and presentation
- `OUTPUT-001` — quiet command output and Cursor-like SDK progress
- `STE-001` — Simplified Technical English for operator-consumed artifacts
- `RUNTIME-001` — sortable workflow runtime names and seven-day archival
- `BIN-001` — self-development-only durable Pancreator shell automation under `bin/`
- `REPO-001` — target-owned, technology-agnostic verification commands
- `AUTO-001` — deterministic automation authority
- `VALID-001` — policy-bound artifact validation
- `CONTRACT-001` — deterministic contract coverage
- `ACTION-001` — safe source-control actions
- `ASK-001` — Cursor-native operator questions and question-method access
- `PAUSE-001` — operator pause authority and workspace edits while paused
- `ORCH-001` — supervisor continuation and stop conditions
- `INVOCATION-001` — canonical invocation validation and delegation delivery
- `EXECUTOR-001` — external stage executors: preflight, permissions, and harness-authored audit
- `OPERATOR-001` — operator supremacy and execution of explicit directives
- `WAIVER-001` — flexible operator waiver directives and optional follow-up
- `ENG-001` — engineering handbook baseline and proportionate automated-test coverage
- `INTAKE-001` — faithful intake (design workflow)
- `PLAN-002` — consolidated planning shared by every planner: faithful specification, implementation-ready plan, traceable acceptance criteria, and an executable test plan
- `DEV-001` — implementation discipline
- `VERIFY-001` — joint read-only verification with a graded verdict
- `REMED-001` — verdict-routed remediation with verdict-scoped authority
- `TS-001` — self-development-only TypeScript conformance
- `PY-001` — Python conformance for detected Python workspaces
- `BROWSER-001` — isolated browser inspection and Visual QA host safety
- `SHIP-001` — operator-owned release boundary
- `PR-001` — grounded pull-request description generation
- `DECOMP-001` — conservative intake-scope decomposition
- `DIAG-001` — evidence-based investigation
- `REPAIR-001` — transcript-aware harness repair investigation and self-development intake
- `WORK-001` — systematic versus lightweight work-mode determination
- `SPOT-001` — bounded lightweight spotfix execution and escalation
- `PAIR-001` — operator-directed pair programming outside workflow structure
- `SHEPHERD-001` — bounded PR feedback watching, ledgered bot discipline, and squad-gated pushes
- `REVIEW-001` — standalone review-squad session over one captured target, findings only
- `PROTO-001` — prototype spike discipline and declared shortcuts
- `BESTOFN-001` — best-of-N session boundaries: isolated worktrees, operator-owned repair, and no source-control action
- `DIRECTOR-001` — technical-director checkpoints for contract-enabled runs
- `COHORT-001` — cohort plan hierarchy and fan-out execution: parent and child specifications, the chunk carve-up, worktree isolation, ordered groups, durable completion proof, and bounded autostart

The prototype MUST NOT use an implicit policy override hierarchy. Conflicting policy text MUST be treated as a configuration defect and resolved directly.

## Chunking surfaces

Two surfaces carve work into units, and the operator kept both.

- `COHORT-001` governs the planner's carve-up of scope the operator already ratified inside one planning gate. It owns the parent and child specification hierarchy, the chunk independence bar, the fragmentation economics, the cohort assignment, and the serial outcome. It binds only to the planning workflow and to the `delivery-chunk` runs that consume the hierarchy, so the best-of-N candidate planner receives `PLAN-002` alone.
- `DECOMP-001` governs the standalone decomposition mode, which assesses an unratified intake before a plan exists. It stays bound only to that mode and is unchanged.

`governance/registries/context_bloat_dispositions.json` records the retained overlap between the two under `planner-and-standalone-chunking`.
