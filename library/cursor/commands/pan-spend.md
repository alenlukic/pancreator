Generate a Cursor token spend report for the period in `$ARGUMENTS`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode spend` and read the card it writes in full. Do not generate a second card for this session.
2. Accept only `--days <1..365>` and `--json`. Use 14 days when `--days` is absent. Stop with the command's argument error when the value is invalid.
3. When `$ARGUMENTS` contains `--json`, run `{{PANCREATOR_PAN_COMMAND}} spend --days <days> --json`, return the aggregate JSON, and stop. Treat the returned aggregate report as the complete data source. Do not expose or reconstruct raw API events, email addresses, conversation ids, cloud agent ids, or credentials.
4. Otherwise, read and apply `{{PANCREATOR_HARNESS_PATH}}library/skills/spend-canvas.md` and the Cursor Canvas skill. Resolve the canvas path `cursor-spend-<days>d.canvas.tsx` in Cursor's managed canvas directory for this workspace.
5. Run `{{PANCREATOR_PAN_COMMAND}} spend --days <days> --canvas <absolute-path> --json`. The harness renders the standard spend canvas from the aggregate report.
6. Confirm the Canvas TypeScript check reports no errors. If Canvas creation fails, return the concise aggregate summary and the concrete failure. Otherwise open the canvas as the skill directs.
7. Link the Canvas with its absolute path and state the total tokens, labeled cost, Cursor fee, date range, and lowest attribution coverage. Name the Canvas as the operator's next read.
