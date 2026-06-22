## Objective

Exercise the implementation as a user and against each acceptance criterion, and
produce reproducible evidence.

## Steps

1. Read the card, acceptance criteria, and implementation record.
2. Derive one or more manual cases per acceptance criterion, or justify why a
   case is not applicable.
3. Execute the cases and record setup, action, expected result, actual result,
   and evidence.
4. Classify each defect as product, environment, or harness/test.

## Output

Populate `data.test` (`verdict`, `cases`, `defects`, `acceptance_results`). Set
the verdict to fail for any unresolved blocking defect or uncovered hard
criterion. Write a markdown QA report artifact and reference it.

## Done when

Manual cases cover every acceptance criterion, the full automated suite and
coverage pass when rerun, and defects are routed to their owners.
