# Spend report canvas

Use when a session turns a `pan spend` or `pan spend report` result into a Cursor
Canvas. `/pan-spend` and `/pan-cost` both follow this skill. The spend card
boundaries stay in force: the aggregate report is the only data source.

## Principle

The canvas is a rendering of one report, not a second analysis. Every figure on
it comes from the report JSON that the harness embeds, so a canvas never carries
a number that a model copied, rounded, or summed by hand.

## Procedure

1. Resolve the canvas path. Cursor detects a canvas only directly inside
   `~/.cursor/projects/<workspace>/canvases/`, where `<workspace>` is the
   workspace path with each `/` replaced by `-` and the leading `-` dropped.
   Name the file `cursor-<command>-<days>d.canvas.tsx`, for example
   `cursor-cost-7d.canvas.tsx`. Reuse that name for a rerun of the same window so
   the operator keeps one canvas per window.
2. Render it with the harness. Pass the absolute path to `--canvas`:

   ```sh
   pan spend report --days <days> --canvas <absolute-path> --json
   pan spend --days <days> --canvas <absolute-path> --json
   ```

   The command writes the canvas from `library/templates/spend-report.canvas.tsx`
   and prints `status: rendered`, the canvas path, the period, the totals, and the
   lowest attribution coverage.

3. Confirm the Canvas TypeScript check. The check runs only on an edit through
   the file tools, so read the rendered file and make one whitespace edit to it.
   Treat any reported error as a template defect. Report it with the error text,
   and do not hand-edit report data to silence it.
4. Open the canvas beside the chat with the `cursor-app-control` `open_resource`
   tool and a `file://` URI of the absolute path. When that tool is unavailable,
   link the path and say that it did not open automatically.
5. Report the outcome under `COMMS-001`. Link the canvas with its absolute path,
   and state the date range, charged cost, the Cursor fee, total tokens, and the
   lowest attribution coverage.

## Layout

The template owns this layout. Change the template, not a rendered canvas, when
the format must change.

| Section        | Content                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Header         | Title with the window in days, and a caption with the UTC range, the source, and the scope.            |
| KPI row        | Charged cost, Cursor fee with its share, events, tokens, and the cache-read token share.               |
| Headline       | One callout. With fee data it states the fee share; without it, the most expensive day.                |
| Daily          | Charged cost per UTC day, split into model cost and Cursor fee, beside tokens per day by category.     |
| Stage and role | Horizontal bars split into model cost and fee. Unattributed stage events are omitted and named.        |
| Tables         | Command and persona-model tables with events, cost, share, fee, fee share, cost per event, and tokens. |
| Cards          | Fast mode, governance, and remediation summaries.                                                      |
| Tools          | Cost of the conversations that used each tool, with the overlap stated.                                |
| Instances      | Only for `pan spend report`: each instance's harness, sync time, selected events, cost, and fee.       |
| Coverage       | Known token share per dimension, with a warning tone below 50%.                                        |
| Notes          | The report's own warnings, verbatim.                                                                   |

## Edge cases

- The template omits a section whose rows are empty. It hides the fee split when
  the report carries no fee. It marks a partial final UTC day with `*`.
- `Other` rows sort last. The tool chart drops `Other`, because tool rows overlap
  and `Other` would dwarf the named tools.
- The Cursor fee is already included in charged cost. A fee derived for events
  that were synced before fees were recorded appears in the report notes.
- Fast mode is known only from an exact `fast=true` or `fast=false` model
  declaration. Max mode is not Fast mode.

## Hard constraints

- You MUST render with `--canvas`. You MUST NOT write report figures into a
  canvas by hand.
- You MUST NOT expose raw usage events, credentials, email addresses,
  conversation ids, or cloud agent ids.
- The template MUST import only from `cursor/canvas` and MUST NOT make a network
  request.
