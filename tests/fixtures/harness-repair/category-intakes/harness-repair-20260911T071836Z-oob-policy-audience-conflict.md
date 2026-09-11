# Harness repair intake

**State:** Ready for out-of-band execution.
**Outcome:** Confirmed one policy defect that no workflow run can repair safely.
**Blockers:** None.
**Next action:** Hand this file to an operator-supervised out-of-band session.
**Category:** Out-of-band (`oob`)

## Original report

The operator reported that a policy instruction reaches no card, so the rule it
states binds nobody.

## Investigation scope

The policy instruction audience model and the lookup rows that resolve the
affected policy.

## Evidence examined

- The policy catalog entry and its instruction audiences.
- The lookup rows that name the policy.
- The rendered worker and supervisor cards for those rows.

## Agent transcript coverage

Agent transcripts are not applicable here, because the defect is in static
governance rather than in a run. The delegation records of the reporting run
were read as prompt-delivery evidence and are not agent transcripts.

## Execution timeline

Not applicable. No workflow run is involved in this finding.

## Findings

### HR-001 A policy instruction renders on no card

- **Classification:** governance miss
- **Severity:** high
- **Evidence:** The instruction carries an audience whose only lookup row
  resolves a card that filters it out.
- **Expected contract:** Every instruction reaches at least one card producer.
- **Causal chain:** The audience was narrowed without a matching lookup row.
- **Root cause:** The audience change and the lookup row change landed in two
  separate edits, and nothing tied them together.
- **Affected surfaces:** the policy catalog, the lookup table, and the
  registry-integrity checks.

## Root-cause remediation

HR-001: correct the audience or the lookup row so the instruction reaches a
card, then decide which of the two the governance author intended. The choice
changes what the rule binds, so it belongs to a supervised session with the
operator rather than to an autonomous implementation run.

## Acceptance criteria

1. AC-001 HR-001 The instruction renders on at least one resolved card.
2. AC-002 HR-001 The operator ratifies which surface the rule binds before the
   edit lands.

## Validation plan

Re-resolve the affected lookup rows and read the rendered cards, then run the
repository validation sweep and confirm it reports no policy that reaches no
card.

## Installation and migration impact

No state migration is required. A fresh installation picks up the corrected
policy with its next projection.

## Constraints and out of scope

Do not broaden the rule while repairing its delivery, and do not change another
policy audience in the same session.

## Open questions and unknowns

Whether the author meant the rule for the supervisor or for the worker is
unresolved and needs the operator.

## Recommended next action

Execute this intake out-of-band with a powerful model under close operator
supervision. The operator decides which surface the rule binds before any edit
lands, so no autonomous workflow run owns this repair.
