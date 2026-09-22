Generate a Cursor token spend report for the period in `$ARGUMENTS`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode spend` and read the card it writes in full. Do not generate a second card for this session.
2. Accept only `--days <1..365>` and `--json`. Use 14 days when `--days` is absent. Stop with the command's argument error when the value is invalid.
3. Run `{{PANCREATOR_PAN_COMMAND}} spend --days <days> --json`. Treat the returned aggregate report as the complete data source. Do not expose or reconstruct raw API events, email addresses, conversation ids, cloud agent ids, or credentials.
4. When `$ARGUMENTS` contains `--json`, return the aggregate JSON and stop.
5. Otherwise, read and apply the Cursor Canvas skill. Write one descriptive `.canvas.tsx` file directly in Cursor's managed canvas directory for this workspace. Import only from `cursor/canvas`, embed the aggregate report, and make no network request from the canvas.
6. Build a concise report with:
   - one title and source caption that name the UTC date range and embedded installations scanned;
   - a compact KPI row for total tokens, charged spend, cached-token share, and attribution coverage;
   - labeled daily token and charged-spend time series;
   - a stacked token-category chart for input, output, cache write, and cache read;
   - top command, persona and model, tool, and workflow-stage views;
   - compact Fast mode, governance, supervisor/stage, and remediation views;
   - short attribution notes beside inferred views.
7. Limit ranked views to the report's folded rows. State that tool token totals overlap because one conversation can use several tools. State that Fast mode is known only when a local model declaration records `fast=true` or `fast=false`. Do not call Max mode Fast mode.
8. Omit a chart, table, or section when it has no real data. Use Canvas charts and tables, theme tokens, clear labels and units, restrained color, and varied visual hierarchy. Do not use gradients, emojis, box shadows, decorative borders, or a wall of identical cards.
9. Confirm the Canvas TypeScript check reports no errors. If Canvas creation fails, return the concise aggregate summary and the concrete failure.
10. Link the Canvas with its absolute path and state the total tokens, charged spend, date range, and lowest attribution coverage. Name the Canvas as the operator's next read.
