# Spend ROI audit

Use during a harness repair audit to find token and dollar spend that buys too
little. The harness technician applies it on every audit, without being told
where to look. It joins the Cursor spend report to workflow and transcript
records. The sibling skill `run-efficiency-audit.md` measures the same work in
time and agents. Fixing both sets of findings makes the harness faster and
cheaper.

## Principle

Spend is a cost only in relation to what it delivered. A finding names the
money, the value unit it bought, and the gap between them. The spend report is
aggregate, so every join to a run or stage is inference and says so.

## Procedure

1. Run the spend report. This is the aggregate `/pan-spend --days 7 --json`
   returns. Use a longer window only when the operator asks for one.

   ```sh
   pan spend --days 7 --json
   ```

   Record the period, `totals`, `token_categories`, `period.cost_basis`, every
   `coverage` block, and every warning. Do not copy raw events, email
   addresses, conversation ids, or credentials into the intake. When the command
   fails, for example with `CURSOR_USAGE_CREDENTIAL_MISSING`, record the error
   as an evidence gap. Without spend data no finding is confirmed in this
   category.

2. Build the value side for the same window from workflow records under
   `runtime/logs/workflows/`: runs by terminal status, stage visits per stage,
   verify-to-remediate cycles, waived gates, releases shipped, and changed
   paths per run. Read the relevant agent transcripts for tool calls per worker,
   repeated reads, and the size of each worker's contract.
3. Join the two sides by slice:
   - `slices.stages` against stage visits: cost per visit, and the share of
     review, verify, and remediate against implement.
   - `slices.remediation`: the remedial share of workflow spend, which is the
     price of rework.
   - `slices.persona_models` against each role's transcript work: model tier
     against task difficulty.
   - `slices.commands` and `slices.governance`: standalone modes, and the ad hoc
     share outside every governed mode.
   - `slices.fast_mode`: Fast premium on work where no operator waited.
   - `token_categories`: cache writes and input tokens per event, which measure
     context weight.
   - Runs that ended aborted, canceled, or failed: spend that shipped nothing.
     Attribute it through the stage and persona slices and the run's
     transcripts, and label the estimate.
4. Triggers. Each is a cost rule whose only backing is money, and `REPAIR-001`
   lets a recorded reason override one. A finding needs a measured cost, the
   value unit it bought, and at least one trigger:
   - R1: a stage, persona, or command holds at least 10% of window cost while
     at least 30% of its visits end in rework, abandonment, or no used output.
   - R2: remedial spend is at least 25% of workflow spend.
   - R3: a role runs on a top-tier model while its transcripts show routine
     work, such as templated output or read-only checks, that a lower tier
     already completes elsewhere in the window.
   - R4: runs that shipped nothing hold at least 15% of workflow spend.
   - R5: the attribution coverage a finding depends on is below 80%. The gap
     itself is a finding, because it hides the return on that spend.
   - R6: cache writes plus input tokens exceed 90% of tokens, or one role's
     contract weight drives most of its input tokens.
   - R7: Fast mode or a premium model runs unattended background work.
5. Cite, for each finding: the report period and cost basis, the slice key,
   the metric, its value and share of the total, the coverage of that slice,
   the run ids and invocation ids of the value side, the trigger id, and the
   inference that joined them. Estimate the monthly saving as the window cost
   the remediation removes, scaled to 30 days.
6. Report the window total, the labeled cost, and the lowest coverage in the
   audit report, together with each triggered signal.

## Category boundaries

- Agent/process inefficiency: the same waste measured in time, agents, and
  attention. File a finding under the measure its remediation moves most, and
  name the sibling intake by file name when both apply.
- Performance: the harness code, the suite, or a gate is slow. Cost/ROI is
  what the models charge for the work around that code.
- Mechanical friction and failure categories: something forces a workaround
  or breaks. Cost/ROI needs no failure, only a poor return.
