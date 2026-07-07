# Policy catalog

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Policies MUST be small, globally identified JSON modules. `governance/registries/policy_lookup_table.json` MUST select policies by persona, workflow, stage, and optional detected workspace `technology`. The harness MUST union all matching rows and snapshot the resulting policies into each invocation card. Technology-scoped rows MUST activate only when the resolved target workspace contains the corresponding declared markers or source files. A policy that depends on durable static guidance MUST declare it through `guidance_sources`; the resolver MUST snapshot the selected guidance content into the invocation rather than require the worker to open the source file.

- `GLOBAL-001` — operator-first records
- `GLOBAL-002` — bounded context retrieval
- `BRIEF-001` — semantic HTML operator brief structure and presentation
- `OUTPUT-001` — quiet command output and Cursor-like SDK progress
- `RUNTIME-001` — sortable workflow runtime names and seven-day archival
- `BIN-001` — self-development-only durable Pancreator shell automation under `bin/`
- `REPO-001` — target-owned, technology-agnostic verification commands
- `AUTO-001` — deterministic automation authority
- `VALID-001` — policy-bound artifact validation
- `CONTRACT-001` — deterministic contract coverage
- `ACTION-001` — safe source-control actions
- `PAUSE-001` — operator pause authority and workspace edits while paused
- `ORCH-001` — supervisor continuation and stop conditions
- `INVOCATION-001` — canonical invocation validation and delegation delivery
- `OPERATOR-001` — operator supremacy and execution of explicit directives
- `WAIVER-001` — flexible operator waiver directives and optional follow-up
- `ENG-001` — engineering handbook baseline and proportionate automated-test coverage
- `INTAKE-001` — faithful intake
- `PLAN-001` — proportionate planning
- `DEV-001` — implementation discipline
- `TS-001` — self-development-only TypeScript conformance
- `PY-001` — Python conformance for detected Python workspaces
- `REVIEW-001` — independent review
- `TEST-001` — evidence-based QA
- `SHIP-001` — operator-owned release boundary
- `PR-001` — grounded pull-request description generation
- `DECOMP-001` — conservative intake-scope decomposition
- `DIAG-001` — evidence-based investigation
- `REPAIR-001` — transcript-aware harness repair investigation and self-development intake
- `WORK-001` — systematic versus lightweight work-mode determination
- `SPOT-001` — bounded lightweight spotfix execution and escalation

The prototype MUST NOT use an implicit policy override hierarchy. Conflicting policy text MUST be treated as a configuration defect and resolved directly.
