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
   lowest attribution coverage. Add `--trends` to also write
   `<name>-trends.canvas.tsx` beside it from
   `library/templates/spend-trends.canvas.tsx`; the result names it as
   `trends_canvas`. Add `--brackets <labels> --brackets-file <path>` to draw
   resolved periods, as the bracket procedure below directs; the result lists
   the drawn brackets and the skipped labels.

3. Confirm the Canvas TypeScript check on each written canvas. The check runs
   only on an edit through the file tools, so read the rendered file and make
   one whitespace edit to it, then revert it. Treat any reported error as a
   template defect. Report it with the error text, and do not hand-edit report
   data to silence it.
4. Open each canvas beside the chat with the `cursor-app-control`
   `open_resource` tool and a `file://` URI of the absolute path. When that tool
   is unavailable, link the path and say that it did not open automatically.
5. Report the outcome under `COMMS-001`. Link the canvas with its absolute path,
   and state the date range, charged cost split into on-demand cost and
   included usage, the Cursor fee, total tokens, and the lowest attribution
   coverage.

## Brackets

A bracket marks one labeled period above the daily charged cost chart. The
operator supplies labels such as `athene-demo` or `excessive-fast-mode-usage`;
the agent resolves each to UTC dates, because the harness cannot reach the
integrations that date them.

1. Search every connected source that can date the label, and continue past
   one that is unavailable: meeting notes (Granola), calendar and mail,
   chat (Slack), the agent transcripts, and the aggregate report itself.
2. Choose the period by the label's kind:
   - A single event, such as a message or a meeting, is the UTC day it
     happened.
   - A demo or launch runs from its first preparation session to the event day.
   - A usage pattern, such as heavy Fast mode use, is the run of days the
     aggregate report shows it. Render once with `--trends` and read the
     trends series to find that run.
3. When the evidence and a date the operator gave disagree, use the evidence
   and report the difference.
4. Write `spend-brackets.json` beside the governance card: an array of
   `{ "label", "name", "start", "end", "source" }` entries. `name` is the label
   in readable words, without hyphens. `source` is `transcript`, `calendar`,
   `mail`, `granola`, `slack`, `operator`, or `other`. A one-day period may omit
   `end`. Record nothing else: no message text, people, email addresses, or ids.
5. Pass `--brackets <labels> --brackets-file <path>`. A label may instead carry
   its period inline as `label@YYYY-MM-DD..YYYY-MM-DD`, which records source
   `operator`. A label without a period is skipped and reported, and periods are
   clamped to the report window.

Overlapping brackets take separate lanes. A table under the chart gives each
period's days, charged cost, share of the window, daily rate, and that rate
against the window average.

## Layout

The template owns this layout. Change the template, not a rendered canvas, when
the format must change. Both templates share the chart code in
`library/templates/spend-canvas-shared.tsx`, which the harness pastes in.

| Section        | Content                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Header         | Title with the window in days, and a caption with the UTC range, the source, and the scope.          |
| KPI row        | On-demand cost and included usage, Cursor fee with its share, events, tokens, and cache-read share.  |
| Headline       | One callout. With fee data it states the fee share; without it, the most expensive day.              |
| Daily          | Charged cost per UTC day, split into included usage, on-demand model cost, and on-demand Cursor fee. |
| Stage and role | Horizontal bars with the same included and on-demand split. Unattributed stage events are omitted.   |
| Tables         | Command and persona-model tables with events, cost, on-demand, included, share, fee, and tokens.     |
| Cards          | Fast mode, governance, and remediation summaries.                                                    |
| Tools          | Cost of the conversations that used each tool, with the overlap stated.                              |
| Instances      | Only for `pan spend report`: each instance's harness, sync time, selected events, cost, and fee.     |
| Coverage       | Known token share per dimension, with a warning tone below 50%.                                      |
| Notes          | The report's own warnings, verbatim.                                                                 |

With brackets, the daily cost chart takes the full width, carries the red
brackets, and adds the period table.

The trends canvas compares the first half of the window with the second. It
buckets by UTC day up to 21 days and by week beyond that.

| Section            | Content                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| KPI row            | Recent daily cost against the earlier rate, top model, Fast share, included share, supervisor share. |
| What changed       | Generated sentences on the cost rate, the top model, included usage, and the largest single shift.   |
| Cost               | Daily included and on-demand cost, bracketed when brackets exist, and cumulative cost.               |
| Model and provider | Share of cost by model and by vendor per bucket, and a per-model then-and-now table.                 |
| Fast mode          | Share of cost by Fast mode per bucket, with its token coverage.                                      |
| Allocation         | Share of cost by workflow role and by attributed stage per bucket.                                   |
| Efficiency         | Cost per event, Cursor fee share of cost, and cache-read share of tokens per bucket.                 |
| Commands           | Share of cost by command per bucket.                                                                 |
| Movers             | The ten keys whose daily cost moved most between the halves, at least $1 a day.                      |

## Edge cases

- The template omits a section whose rows are empty. It hides the fee split when
  the report carries no fee, and the included split when no usage was
  included. It marks a partial final UTC day with `*`.
- Included usage is the charged cost of events Cursor billed against the
  plan's included allowance. On-demand cost is the rest of charged cost.
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
