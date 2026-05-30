# Plan — cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref

## Architecture summary

The implementation SHOULD extend existing CLI and MCP command routing in place, with shared helper primitives for deferred envelopes, intake path/time derivation, and active-memory section rewrites so WP-1, WP-2, and WP-3 stay deterministic and testable. The coder SHOULD limit source edits to current command entry surfaces and paired tests, then update the two normative docs required by the spec acceptance criteria.

## Implementation phases

1. Baseline and guardrails
   1. Capture baseline behavior in `run.ts` and `pan-execute.ts` around stub responses.
   2. Add constants for deferred envelope shape and stable non-zero return handling.
   3. Keep command parsing and existing feature-delivery workflow semantics unchanged.
2. WP-1 deferred envelope protocol
   1. Replace CLI stub payloads with `status: "deferred"` envelopes containing verb, milestone, tracking pointer, and workaround text.
   2. Ensure deferred CLI invocations return a stable non-zero code without changing non-deferred command success paths.
   3. Mirror the envelope in MCP tool stubs keyed by tool name and map to a non-success MCP response path.
   4. Add deferred milestone tags to `pan --help` and deferred subcommand help text.
3. WP-2 intake scaffolder (`pan intake new <slug>`)
   1. Add a new `intake` command group and `new` subcommand in CLI routing.
   2. Compute `<day-bucket>`, SID, HHMM, and `created_at` from UTC clock only.
   3. Enforce overwrite refusal, archived-bucket refusal, and missing `pancreator.yaml` refusal.
   4. Implement default template and optional `--from-template` body loading from handbook templates.
4. WP-3 active-memory refresher (`pan refresh-active-memory [--dry-run]`)
   1. Add command wiring in CLI with deterministic derivation from `lib/inbox/in/` and `lib/memory/features/*/index.json`.
   2. Restrict writes to the three labeled sections only.
   3. Add dry-run diff output and mismatch conflict detection with non-zero exit.
5. Cross-cutting documentation updates
   1. Update `AGENTS.md` section 6 references for deferral protocol, `pan intake new`, and `pan refresh-active-memory`.
   2. Update `lib/personas/compliance-auditor.md` broad-sweep behavior text to cite refresher usage for M-01/M-03 class staleness findings.
6. Verification
   1. Run `node --test tests/*.test.mjs`.
   2. Run `node lib/internal/tools/check-phase-0a-scaffold.mjs`.
   3. Run `node lib/internal/tools/context-budget-report.mjs`.
   4. Run `bash -n .cursor/hooks/enforce-policy-compliance.sh`.

## Risks and mitigations

- Help-output regressions from Commander wiring changes; mitigate by asserting deferred tags in CLI tests.
- Time-derived filename drift around UTC boundaries; mitigate with deterministic clock injection tests.
- Active-memory clobber risk in manually curated sections; mitigate with strict labeled-slice editing and conflict exits.
- MCP/CLI envelope drift; mitigate with shared fixture assertions across `run.test.ts` and `pan-execute.test.ts`.
- Documentation drift from cross-cutting acceptance criteria; mitigate with explicit doc-surface entries in touch-set and completion checklist.

## Documentation impact decision

```yaml
documentation_impact:
  applies: true
  rationale: "Spec acceptance criteria require AGENTS and compliance-auditor procedure updates in the same delivery."
  changed-surfaces:
    - AGENTS.md
    - lib/personas/compliance-auditor.md
  deferred-items: []
```

## References

- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [66, 85]
  contentHash: TBD-on-commit
  note: Work-package scope for WP-1/WP-2/WP-3.
- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [89, 178]
  contentHash: TBD-on-commit
  note: Acceptance criteria and test obligations.
- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [181, 187]
  contentHash: TBD-on-commit
  note: Cross-cutting documentation updates for AGENTS and compliance-auditor.
- kind: lines
  path: work/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/handoff.md
  range: [38, 44]
  contentHash: TBD-on-commit
  note: Validation command contract to preserve in implement stage.
