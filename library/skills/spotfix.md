# Spotfix

Use for one operator-selected lightweight remediation: a one-off issue or a
small-scope feature, update, or governance change.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Eligibility

Before editing, apply `WORK-001`.

- The request MUST be one coherent change with supplied or readily derivable
  acceptance criteria.
- Core implementation MUST remain within three files in one module or bounded
  subsystem. Tests, documentation, generated projections, and an escalation
  inbox item do not count toward that limit.
- The work MUST NOT require unresolved product or architecture decisions or a
  cross-module, schema, dependency, security, concurrency, release-process, or
  structural-performance redesign.
- Existing repository checks MUST be capable of establishing correctness.

If any condition is false or uncertain, do not edit. Recommend `systematic` and
create the escalation item described below.

## Process

1. Preserve the original input and inspect the actual repository state.
2. Write numbered acceptance criteria before editing when the input does not
   already provide them.
3. Map each criterion to the intended implementation and automated-test
   evidence.
4. Implement the smallest coherent change.
5. Add unit tests for core functionality and likely edge cases under `ENG-001`.
   Use integration or regression coverage only when it is the narrower truthful
   proof, and record why.
6. Run one validation cycle. A cycle is an implementation edit set followed by
   validation.
7. When validation fails, use the evidence to make a bounded correction and run
   the next cycle. Perform no more than three cycles total.

Do not broaden scope to force a pass. A newly discovered non-lightweight
requirement ends lightweight execution.

## Validation

The final successful cycle MUST establish all of the following:

- the configured repository-check profiles applicable to the change pass;
- direct checks and any target-documented build, static, or focused test commands pass;
- every acceptance criterion has concrete evidence;
- existing behavior outside the requested change remains intact.

Use `runtime/repository-checks.json` as the command authority. Preserve its
explicit toolchain entrypoints and probes, and do not infer ecosystem commands.
A missing profile, unavailable dependency, timeout, or check that cannot run is
not a pass. Record it as incomplete validation and determine whether systematic
routing is required.

## Escalation

Escalate immediately when the request is not small-scope, and escalate after the
third failed validation cycle.

Create a uniquely named Markdown item at
`runtime/inbox/spotfix-escalation-<UTC timestamp>-<slug>.md` containing:

- the original request or investigator output verbatim;
- acceptance criteria;
- root-cause and scope findings;
- files changed or partially changed;
- each validation cycle, command, result, and relevant error;
- unresolved blockers and risks;
- the recommended systematic workflow entry point and next action.

Do not claim success after escalation. Do not commit, push, merge, publish,
deploy, or invoke `pan set-stage`.

## Operator-facing output

Return one Markdown document with these sections:

1. `# Spotfix outcome`
2. `## Status` — `success`, `blocked`, or `escalated`
3. `## Summary`
4. `## Acceptance criteria` — criterion-by-criterion result and evidence
5. `## Changes implemented` — files and behavior
6. `## Validation` — command, cycle, and result
7. `## Blockers and risks`
8. `## Escalation` — inbox path when created
9. `## Recommended next action`
