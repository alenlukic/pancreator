# Map acceptance criteria

Use when planning: turning a product spec into acceptance criteria that fully
cover the requirements and are individually testable.

## Principle

Every requirement traces forward to at least one criterion, and every criterion
traces back to at least one requirement. No orphans in either direction.

## Steps

1. List the approved user stories and explicit requirements.
2. For each, write one or more criteria phrased as observable outcomes ("given
   X, when Y, then Z"), not implementation steps.
3. Attach a verification method to each criterion: a command, a manual case, or
   an inspection.
4. Build the two-way map: requirement to criteria, and criterion to
   requirements. Flag any requirement with no criterion and any criterion with
   no requirement.

## Quality bar

- Each criterion is independently checkable and would fail if the behavior were
  absent.
- Untestable requirements are reformulated to the closest observable proxy, with
  the gap noted.
- Coverage is complete: the set of criteria, if all pass, means the spec is met.
