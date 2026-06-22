# Policy catalog

Policies are small, globally identified JSON modules. `governance/policy_lookup_table.json` selects them by persona, workflow, and stage; all matching rows are unioned and snapshotted into the invocation card.

- `GLOBAL-001` — operator-first records
- `GLOBAL-002` — bounded context retrieval
- `ACTION-001` — safe source-control actions
- `INTAKE-001` — faithful intake
- `PLAN-001` — proportionate planning
- `DEV-001` — implementation discipline
- `REVIEW-001` — independent review
- `TEST-001` — evidence-based QA
- `SHIP-001` — operator-owned release boundary

There is no override hierarchy in the prototype. Conflicting policy text is a configuration defect to resolve directly, not a precedence problem to hide.
