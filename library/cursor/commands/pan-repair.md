Audit the Pancreator problem or artifact identified by `$ARGUMENTS` and produce a
self-development intake without implementing the repair.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md` and preserve `$ARGUMENTS` verbatim as the repair input.
2. Resolve the input without mutating it:
   - Prose remains the primary report.
   - A file or directory path is treated as evidence.
   - A workflow run directory is recognized by Pancreator run records such as
     `state.json`, `events.jsonl`, or `workflow.snapshot.json`.
   - A link supplied by the operator is opened when the current Cursor tool
     context can resolve it; otherwise preserve the link and record the access
     failure as an evidence gap.
3. Determine how many intakes `$ARGUMENTS` requests and default to one intake.
   Choose one unique harness-relative output path under `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/queue/` for
   each intake, named `harness-repair-<UTC timestamp>-<slug>.md`. Give each path
   a distinct slug. When the operator requests more than one intake, require one
   intake for each distinct root cause.
4. When the input identifies a workflow run, collect the relevant agent
   transcripts before delegation. Use transcripts present in the current Cursor
   conversation, transcript links or exports referenced by the input, and any
   transcript artifacts associated with the run. Treat `*.delegation.md` as
   prompt-delivery evidence only, never as a substitute for an agent transcript.
5. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode repair` and read the card it writes. It
   resolves the complete repair governance, including `REPAIR-001`; do not
   assemble policy text by hand. When the operator names a worktree, add
   `--worktree <name>` to create or resolve it. The card then binds the session
   workspace to that worktree.
6. Invoke the `pan-harness-technician` subagent, pasting the complete card
   contents verbatim into its prompt, followed by the original input, resolved
   evidence location, collected transcript references or contents, every output
   path, and the requested intake count. Require it to audit for harness bugs,
   compliance issues, governance misses, agent execution errors,
   target-repository defects, and unresolved hypotheses, and write only the
   intakes at the supplied output paths.
7. Run this command once for each intake path: `{{PANCREATOR_PAN_COMMAND}} requirements run --persona harness-technician --workflow standalone --stage repair --kind repair --registry HARNESS-REPAIR-VALIDATE-001 --target <harness-relative-output-path> --json`.
8. If validation fails for an intake, provide the validator issues to the
   harness technician for one correction attempt, then rerun the same validator
   against that intake. Stop and surface unresolved issues if the second attempt
   fails. Report each intake result separately.
9. Do not modify source, governance, workflow state, the investigated run, or
   target application files. Do not commit, push, merge, publish, or deploy.
10. Surface every validated intake path and its complete contents. State that
    each file can be passed directly to `/pan-start` in the Pancreator
    self-development repository. When you produced more than one intake, state
    the root cause each intake covers and any required remediation order.
