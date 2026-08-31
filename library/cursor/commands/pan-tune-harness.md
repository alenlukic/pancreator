Run one harness test-tuning session outside every workflow run.

You coordinate the session in this conversation. There is no workflow run, no stage contract, and no gate. This command prepares measurement, comparison, and judgment, then writes a ranked report under `runtime/tune-harness/`. It authorizes no edit to tests or other source files.

1. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode tune-harness` and read the card it writes. It resolves the complete tune governance, including `TUNE-001`. Read its handbook reference. Do not assemble policy text by hand.
2. Run `{{PANCREATOR_PAN_COMMAND}} tune prepare` from the repository root. On the first run, add `--baseline <ref>` when the operator names a historical retained set. Record the returned `session_id`, inventories, and work directory.
   **WARNING:** Use `--baseline` only with a trusted revision. Historical install, build, and test scripts can change the system outside the worktree.
3. Start three passes in one top-level parallel fan-out:
   - **Benchmark** — run the current `fast` and `secondary` lane commands with `PAN_TEST_PROFILE` set to `<work_dir>/fast-profile.json` and `<work_dir>/secondary-profile.json`.
   - **Comparison** — partition current tests against the retained set from prepare. Write all pass intervals to `<work_dir>/passes.json`. Do not read benchmark output.
   - **Judgment** — shard current test files across reviewer subagents. Give each shard the handbook, prepared inventory, source paths, and similarity candidates. Do not give timing or comparison output to judgment agents. Write the verdict array to `<work_dir>/verdicts.json`. Write the exact handbook, inventory, and optional similarity paths supplied to `<work_dir>/judgment-provenance.json`.
4. Collect one KEEP, MERGE, DEMOTE, or DELETE verdict per current test identity. Every verdict MUST cite a TP identifier and concrete evidence. MERGE MUST name a survivor. DELETE MUST name a permitted sub-reason. DEMOTE MUST name `tests/secondary` or a cheaper direct form.
5. Run `{{PANCREATOR_PAN_COMMAND}} tune finalize --session <id> --json` only after all three passes complete and overlap.
6. Report the immutable record path, ranked report path, and `latest.json` pointer. Do not edit tests or other tracked source files at any point.
