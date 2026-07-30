Start a Pancreator workflow from the operator request in `$ARGUMENTS` and supervise it to a stop condition.

You are the supervisor for this run.

1. Read `AGENTS.md`.
2. Preserve `$ARGUMENTS` verbatim in a uniquely named Markdown file under `runtime/inbox/`. Keep its harness-relative path (for example `runtime/inbox/request-<id>.md`) for CLI arguments.
3. Read the preserved request file and derive init options:
   - By default, omit `--workspace` so `config.json.workspace_root` remains authoritative, and use no `gates` override.
   - If the preserved request is JSON containing `workspace_root` (for example a prior run state payload), use it as `--workspace`.
   - If the preserved request is JSON containing `gate_overrides`, write that object to a uniquely named JSON file under `runtime/inbox/` and pass its harness-relative path as `--gates`.
   - Default to `--workflow dev`. Use `--workflow prototype` only when the operator asked for a prototype, spike, or proof of concept, or asked to test an approach rather than deliver it. Use `--workflow design` only when the operator asked for UI/UX design work preceding implementation. When the request is ambiguous between delivering and spiking, ask the operator before initializing.
   - Omit `--involvement` unless the operator named a profile or asked for a specific level of involvement; the configured `active` profile applies otherwise. Run `./bin/pan involvement` to list profiles when the operator asks what is available.
4. Run `./bin/pan init --workflow <workflow> --request <harness-relative-request> [--workspace <workspace>] [--gates <harness-relative-gates-file>] [--involvement <profile>]`, then `./bin/pan prepare <run-id>`.
   - Report the resolved involvement profile, active run contracts, and any gates that replaced a workflow default, so the operator knows where the run will stop.
5. Read the generated invocation Markdown. Intake is owned by you as supervisor: perform only that card, write its declared JSON output, and run `./bin/pan submit`.
6. Present the product specification and current run status to the operator. Stop for ratification unless the current operator request already contains an explicit approval or rejection; in that case, execute that decision rather than asking again.
7. After ratification, run the advance loop below until a stop condition. Do not hand the run back to the operator while a supervisor-owned pending action remains, and do not require a separate `/pan-resume` invocation to continue.

## Advance loop

Repeat until a stop condition:

- `prepare_invocation` → run `./bin/pan prepare <run-id>`, read the generated card, continue.
- `invoke_agent` → deliver the card as specified in **Card delivery** below, then continue.
- `supervisor_assessment` → write the assessment JSON declared by the assessment request card, judging only its listed criteria, run `./bin/pan assess`, continue.
- `operator_approval` → if the current operator request already supplies an explicit approval or rejection, execute it; otherwise present the ratification packet and STOP. When the pending action carries a `checkpoint`, this is a technical-director stop governed by `DIRECTOR-001`: present the stage's substance in full and offer `approve`, `revise --note <directive>` for a refinement of otherwise acceptable work, or `reject --note <reason>` for work the operator declares unacceptable.
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
