# Prototype validation report

Validated on 2026-06-22 with Node.js 22.14.0 and Git 2.47.x.

## Results

- `npm run lint`: passed
- `npm run validate`: passed with no errors or warnings
- `npm test`: 15 tests passed, 0 failed
- `npm run test:coverage`: passed
  - lines: 86.51%
  - branches: 72.51%
  - functions: 90.57%
- `./bin/pan doctor`: passed; zero external runtime dependencies reported
- `bash -n bin/pan scripts/lint.sh`: passed
- Actual-repository smoke run: `init` then `prepare` produced a valid intake
  invocation card with the upgraded markdown rendering and the new `INTAKE-001`
  policy in force.

## Covered behavior

- complete intake -> plan -> implement -> review -> test -> ship path
- operator gates at intake and ship
- supervisor gate at plan
- per-stage workflow file assembly and missing-stage detection
- deterministic shell criteria
- idempotent stage submission
- read-only workspace mutation detection
- content-sensitive Git workspace fingerprints
- stale lock recovery
- write-ahead event recovery of materialized state
- workflow graph and policy resolution validation
- markdown-primary execution record rendering, including validation-issue and
  failure paths

## Known validation limits

Cursor itself was not exercised here, so `.cursor` commands, rule discovery,
subagent model availability, and MCP invocation were validated structurally
rather than through the Cursor UI. Model strings in `.cursor/agents` are current
suggestions and may need adjustment to the exact identifiers exposed by the
operator's Cursor installation.
