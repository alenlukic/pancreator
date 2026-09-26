Generate the multi-instance Cursor cost report canvas for the period in `$ARGUMENTS`, and open it.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode spend` and read the card it writes in full. Do not generate a second card for this session.
2. Read `{{PANCREATOR_HARNESS_PATH}}library/skills/spend-canvas.md` and apply it. Also read the Cursor Canvas skill for the canvas location and file rules.
3. Accept the arguments of `pan spend report`: `--days <1..365>` and `--json`. Use 14 days when `--days` is absent. Stop with the command's argument error when the value is invalid.
4. When `$ARGUMENTS` contains `--json`, run `{{PANCREATOR_PAN_COMMAND}} spend report --days <days> --json`, return the aggregate JSON, and stop.
5. Otherwise, resolve the canvas path `cursor-cost-<days>d.canvas.tsx` in Cursor's managed canvas directory for this workspace. Run `{{PANCREATOR_PAN_COMMAND}} spend report --days <days> --canvas <absolute-path> --json`. Do not expose or reconstruct raw API events, email addresses, conversation ids, cloud agent ids, or credentials.
6. When the command fails, report its error code and message. A missing `spend.vercel_host` or `PAN_SPEND_SYNC_TOKEN` is an operator setup step. Name that step.
7. Confirm that the Canvas TypeScript check reports no errors. Then open the canvas with the `cursor-app-control` `open_resource` tool.
8. Link the canvas with its absolute path. State the UTC date range, charged cost, Cursor fee, total tokens, instance count, and lowest attribution coverage. Name the canvas as the operator's next read.
