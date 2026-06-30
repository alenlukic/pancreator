# Modern code review

Use when reviewing an implementation as an independent gate.

## Principle

Review the resulting workspace, not the implementer's narrative. A finding is
specific, evidenced, and routed to an owner.

## Steps

1. Read the plan and acceptance criteria, then the actual diff and workspace.
2. Verify each acceptance criterion from code and behavior; reproduce where you
   can.
3. Inspect tests: do they assert observable behavior, are they correctly scoped,
   could they pass when the behavior is broken?
4. Assess maintainability, scope control, security, and regression risk.

## Findings

- Each finding cites specific files and lines, states severity, and names the
  owning remediation stage.
- A hard finding forces a failure verdict and routes back to implementation.
- "Looks fine" is not a finding; if you cannot verify a criterion, treat it as
  unmet and state the evidence that would settle it.

## Boundaries

Do not edit source. Route defects back; do not fix them in review.
