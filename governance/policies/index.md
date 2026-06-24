# Policy catalog

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Policies MUST be small, globally identified JSON modules. `governance/policy_lookup_table.json` MUST select policies by persona, workflow, and stage. The harness MUST union all matching rows and snapshot the resulting policies into each invocation card.

- `GLOBAL-001` — operator-first records
- `GLOBAL-002` — bounded context retrieval
- `ACTION-001` — safe source-control actions
- `PAUSE-001` — operator pause authority and workspace edits while paused
- `ENG-001` — engineering handbook baseline and proportionate automated-test coverage
- `INTAKE-001` — faithful intake
- `PLAN-001` — proportionate planning
- `DEV-001` — implementation discipline
- `TS-001` — TypeScript conformance
- `REVIEW-001` — independent review
- `TEST-001` — evidence-based QA
- `SHIP-001` — operator-owned release boundary
- `WORK-001` — systematic versus lightweight work-mode determination
- `SPOT-001` — bounded lightweight spotfix execution and escalation

The prototype MUST NOT use an implicit policy override hierarchy. Conflicting policy text MUST be treated as a configuration defect and resolved directly.
