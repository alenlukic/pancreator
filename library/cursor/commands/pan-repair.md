Audit the Pancreator problem or artifact identified by `$ARGUMENTS` and produce a
self-development intake without implementing the repair.

1. Read `AGENTS.md` and preserve `$ARGUMENTS` verbatim as the repair input.
2. Resolve the input without mutating it:
   - Prose remains the primary report.
   - A file or directory path is treated as evidence.
   - A workflow run directory is recognized by Pancreator run records such as
     `state.json`, `events.jsonl`, or `workflow.snapshot.json`.
   - A link supplied by the operator is opened when the current Cursor tool
     context can resolve it; otherwise preserve the link and record the access
     failure as an evidence gap.
3. Choose a unique harness-relative output path under `runtime/inbox/` named
   `harness-repair-<UTC timestamp>-<slug>.md`.
4. When the input identifies a workflow run, collect the relevant agent
   transcripts before delegation. Use transcripts present in the current Cursor
   conversation, transcript links or exports referenced by the input, and any
   transcript artifacts associated with the run. Treat `*.delegation.md` as
   prompt-delivery evidence only, never as a substitute for an agent transcript.
5. Invoke the `harness-technician` subagent with the original input, resolved
   evidence location, collected transcript references or contents, and output
   path. Require it to apply `REPAIR-001`, audit for harness bugs, compliance
   issues, governance misses, agent execution errors, target-repository defects,
   and unresolved hypotheses, and write no other file.
6. Run `./bin/pan requirements run --persona harness-technician --workflow standalone --stage repair --kind repair --registry HARNESS-REPAIR-VALIDATE-001 --target <harness-relative-output-path> --json`.
7. If validation fails, provide the validator issues to the harness technician
   for one correction attempt, then rerun the same validator. Stop and surface
   unresolved issues if the second attempt fails.
8. Do not modify source, governance, workflow state, the investigated run, or
   target application files. Do not commit, push, merge, publish, or deploy.
9. Surface the validated intake path and its complete contents. State that the
   file can be passed directly to `/pan-start` in the Pancreator self-development
   repository.
