Resume or advance Pancreator run `$ARGUMENTS`.

You are the supervisor for this run.

1. Read `AGENTS.md` and run `./bin/pan status $ARGUMENTS --json`.
2. Run the advance loop below until a stop condition.

## Advance loop

Repeat until a stop condition:

- `prepare_invocation` → run `./bin/pan prepare <run-id>`, read the generated card, continue.
- `invoke_agent` → deliver the card as specified in **Card delivery** below, then continue.
- `supervisor_assessment` → write the assessment JSON declared by the assessment request card, judging only its listed criteria, run `./bin/pan assess`, continue.
- `operator_approval` → if the current operator request already supplies an explicit approval or rejection, execute it; otherwise present the ratification packet and STOP. When the pending action carries a `checkpoint`, this is a technical-director stop governed by `DIRECTOR-001`: present the stage's substance in full and offer `approve`, `revise --note <directive>`, or `reject --note <reason>`.
- `operator_decision` → if the current operator request already supplies an explicit decision, execute it; otherwise present the pause context and options and STOP.
- `none` → report the terminal state and STOP.

After each action, show status, outcome, evidence pointers, and the next required action.

## Card delivery

`INVOCATION-001` governs delegation. Every prepared worker card restates this contract with resolved paths under its **Supervisor delivery procedure** section. For each `invoke_agent` action you MUST:

1. Confirm the card's invocation validation artifact reports `pass`. A failed or missing validation artifact MUST NOT be delegated.
2. Read `runtime/logs/workflows/<run-id>/invocations/<invocation-id>.md` and paste its complete contents verbatim into the matching `pan-<persona>` subagent's `prompt`. A path reference, summary, or excerpt MUST NOT substitute for the card body.
3. Persist that exact prompt body to `runtime/logs/workflows/<run-id>/invocations/<invocation-id>.delegation.md`.
4. Add no parallel scope, policy, gate, or plan restatement to the prompt; a minimal non-conflicting persona label MAY precede the card.
5. Submit the worker's declared output with `./bin/pan submit <run-id> <output-json>`.
6. If delegation validation reports a missing or mismatched artifact, repair it against the same active invocation rather than bypassing it or reporting delivery as successful.
