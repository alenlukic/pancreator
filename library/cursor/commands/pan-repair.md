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
3. Fix one UTC timestamp for this audit and reuse it for every intake. The
   audit writes at most one intake for each issue category declared in
   `{{PANCREATOR_HARNESS_PATH}}governance/registries/harness_repair_categories.json`, under
   `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/queue/`, named
   `harness-repair-<UTC timestamp>-<category-slug>-<detail-slug>.md`. The
   category set is unknown until the audit finishes, so supply these inputs
   rather than a list of paths. When `$ARGUMENTS` asks for a different set of
   intakes, such as one document, named categories, or a fixed count, carry
   that directive through in place of the category default.
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
   evidence location, collected transcript references or contents, the registry
   path, the queue directory, the shared UTC timestamp, the filename pattern,
   and any operator directive about the set of intakes. Require it to audit
   every registry category for harness bugs, compliance issues, governance
   misses, agent execution errors, target-repository defects, and unresolved
   hypotheses; to write one intake for each category that produced a confirmed
   finding and none for a category that produced no finding; and to report the
   path of each intake it wrote together with the categories it cleared.
7. Run this command once for each intake path the subagent reported: `{{PANCREATOR_PAN_COMMAND}} requirements run --persona harness-technician --workflow standalone --stage repair --kind repair --registry HARNESS-REPAIR-VALIDATE-001 --target <harness-relative-output-path> --json`.
8. If validation fails for an intake, provide the validator issues to the
   harness technician for one correction attempt, then rerun the same validator
   against that intake. Stop and surface unresolved issues if the second attempt
   fails. Repeat this loop for each failing intake independently and report each
   intake result separately.
9. Do not modify source, governance, workflow state, the investigated run, or
   target application files. Do not commit, push, merge, publish, or deploy.
10. Report every category the registry declares. For a category with an intake,
    give the validated path, its complete contents, the findings it covers, and
    the next action its category contract names; a category routed to
    `/pan-start` can be passed directly to that command in the Pancreator
    self-development repository, and the out-of-band category names supervised
    execution outside the harness. For a category with no confirmed finding,
    state that result explicitly. State any required remediation order across
    the intakes.
