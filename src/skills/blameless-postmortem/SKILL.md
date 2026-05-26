---
name: blameless-postmortem
description: Authors one blameless postmortem stub per Allspaw / Etsy `Debriefing Facilitation Guide` after any pipeline abort. Loads the run log, reconstructs the timeline, surfaces the second-story narrative without naming humans, lists action items, then stages `/src/memory/postmortems/<task-id>-stub.md` for human ratification.
license: Apache-2.0
metadata:
  tesseract-stability: experimental
  tesseract-bootstrap-only: false
  tesseract-pipeline-stages: [pipeline-supervisor, intervention-dispatch, incident-response]
  tesseract-risk-tier: medium
  tesseract-required-handbook:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
  tesseract-emits:
    - /src/memory/postmortems/<task-id>-stub.md
references:
  - kind: lines
    path: docs/PRD.md
    range: [503, 503]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD §6 — MVP roster: supervisor owns the run log and dispatches Intervention actions; the supervisor invokes this skill on every abort per US-10."
  - kind: lines
    path: docs/PRD.md
    range: [533, 533]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD §6 — M4 roster: postmortem-author runs blameless postmortems per Allspaw / Etsy `Debriefing Facilitation Guide`, produces second-story narratives, never points at humans."
  - kind: lines
    path: docs/PRD.md
    range: [225, 246]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD §3.5 US-10 — Intervention spectrum: abort kills the pipeline and disposes the worktree; artifacts and run-log are preserved for postmortem; abort always emits a run-summary artifact for the Librarian."
  - kind: lines
    path: docs/PRD.md
    range: [858, 892]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD §7 — Intervention conventions: state machine, safety invariants, quarantine preserves complete state for postmortem, every intervention dispatch logs the operator identity."
  - kind: lines
    path: docs/PRD.md
    range: [949, 949]
    contentHash: 2ce8e5cbeed520c3e1d54dd8d27fc07a97caa0cfe23ff452082e54048ad1b7f5
    note: "PRD §8 — Memory architecture: `/src/memory/postmortems/` holds blameless RCAs, never modified after publication."
---

# Skill — `blameless-postmortem`

A reusable 6-step procedure that converts one aborted pipeline run into one
blameless postmortem stub. The canonical caller is
`src/personas/supervisor.md` (invokes the skill on every `tess abort` per
PRD §3.5 US-10 line 236 and on every circuit-breaker trip that ends a
run). M4+ adds `src/personas/postmortem-author.md` as the long-form caller
inside the `incident-response` pipeline per PRD §7 line 710.

The stub is a starting point, not a verdict. The human ratifies the
narrative and the action items; the published postmortem is immutable per
PRD §8 line 949.

## Prerequisites

- `/src/work/<day>/<task-id>/run.log.jsonl` SHALL exist and SHALL carry the OpenInference
  spans plus the OTel GenAI semconv parallel layer declared at PRD §7
  line 838; an empty or truncated run log fails the gate.
- `/src/work/<day>/<task-id>/run-summary.md` SHALL exist when the trigger is
  `tess abort` per PRD §3.5 US-10 line 244; the supervisor emits the
  summary on abort per PRD §7 line 890.
- `/src/memory/postmortems/` SHALL exist as a writable directory; the skill
  scaffolds it on first invocation.
- `/src/memory/handbook/glossary.md` and `/src/memory/handbook/contract-style.md`
  SHALL exist; the postmortem stub satisfies Layer 1 lint per PRD §4.6.

## The 6-step postmortem loop

Execute these steps in order, once per aborted run.

### Step 1 — Load the run log and reconstruct the timeline

Read `/src/work/<day>/<task-id>/run.log.jsonl` and parse every span emitted between
the run start and the abort. Build a timeline keyed by ISO-8601
timestamps; each entry MUST list the stage id, the persona id, the tool
call (when present), the gate state (when the entry crosses a gate), and
the operator-identity stamp on every intervention dispatch per PRD §7
line 868.

When a span is missing the operator identity on an intervention dispatch,
the postmortem MUST flag the gap as a `must fix` action item; PRD §3.5
US-10 line 246 declares the operator-identity stamp as a hard gate.

### Step 2 — Identify the proximate cause and the contributing factors

Apply the second-story rubric per Allspaw / Etsy `Debriefing Facilitation
Guide` cited at PRD §6 line 533:

- The **first story** names what failed in surface terms (e.g., "the gate
  rejected the diff", "the runner timed out").
- The **second story** explains why the system's design made the
  first-story outcome reasonable for the agent or the human at the time
  (e.g., "the threshold policy was tighter than the test fixture pinned
  by the prior run", "the contract clause's `cost_ceiling_usd` was set
  before the runner switched to the larger model tier").

The narrative MUST stay in the second story. The skill MUST NOT name a
human or an agent as the proximate cause; PRD §6 line 533 forbids
human-pointing phrasing.

### Step 3 — Apply the safety-invariant audit

Walk every safety invariant declared at PRD §7 lines 884 through 892 and
record `held` or `violated` for each:

| invariant | source |
| --- | --- |
| rollback / abort never destroys uncommitted human edits | PRD §7 line 884 |
| quarantine preserves complete state for postmortem | PRD §7 line 889 |
| abort always emits a run-summary artifact for the librarian | PRD §7 line 890 |
| every intervention dispatch logs the operator identity | PRD §7 line 868 |
| no advance past `quarantine` without an explicit `tess release` | PRD §7 line 883 |

Each invariant MUST cite the run-log span (or the absence thereof) that
proves the verdict via dual-anchor citation per PRD §8.

### Step 4 — Author the seven-section stub

Overwrite `/src/memory/postmortems/<task-id>-stub.md` with exactly seven `##`
sections in this order. Missing sections fail the gate.

1. **Run identity.** Frontmatter-style block listing the `task-id`, the
   pipeline name, the abort timestamp in ISO-8601, the operator identity
   that dispatched the abort, and the worktree commit hash at abort.
2. **Timeline.** A bulleted list built from Step 1, one bullet per stage
   transition or intervention dispatch.
3. **First story.** One paragraph at most 80 words naming the surface
   failure.
4. **Second story.** One to three paragraphs explaining why the design
   made the surface outcome reasonable. The narrative MUST stay system-
   focused per PRD §6 line 533.
5. **Safety-invariant audit.** The table built in Step 3.
6. **Action items.** A bulleted list. Each item MUST follow EARS, MUST
   carry an owner persona handle, and MUST link the run-log span (or the
   contract clause) it remediates.
7. **Open questions.** A bulleted list of at most 5 questions the human
   ratification MUST close. An open question without a candidate
   resolution path fails the gate.

The full body MUST stay at most 2000 words across the seven sections
combined.

### Step 5 — Run Layer 1 lint against the body

Apply the Layer 1 lint discipline declared in
`/src/memory/handbook/contract-style.md` to every normative clause in the
stub. Each rule MUST hold:

- One RFC 2119 obligation keyword per normative clause.
- One EARS template per normative clause.
- Active voice and present tense.
- Numeric claims quantified with units.
- No weasel words from the PRD §4.6 ban list.
- Every domain noun resolves to `/src/memory/handbook/glossary.md`.
- Median sentence length at most 30 words.
- p95 sentence length at most 40 words.

The skill MUST also enforce the second-story rubric: the body MUST NOT
contain any of the human-pointing phrases banned by Allspaw, including
"human error", "operator error", "should have known", "failed to follow",
or any synonym that names a human as the proximate cause.

Apply at most 3 self-correction rounds. On the 4th unresolved violation,
escalate via inbox per the R29 friction-circuit-breaker pattern from
PRD §13.

### Step 6 — Stage the stub and route the ratification ask

When all gates are green, you MUST:

1. Stage `/src/memory/postmortems/<task-id>-stub.md`. You MUST NOT commit;
   you MUST NOT push. The published postmortem is immutable per PRD §8
   line 949 and lands at `/src/memory/postmortems/<task-id>.md` only after
   human ratification.
2. Open one inbox item at
   `src/inbox/in/<timestamp>-postmortem-<task-id>-ratification.md`
   summarizing the second story, the safety-invariant verdict, and the
   open questions.
3. Schedule the action items in `/src/memory/backlog/items/` through the
   `librarian` post_run hook; each action item carries the postmortem's
   `task-id` as a `cause:` reference per PRD §8.
4. When the abort tripped a circuit breaker per PRD §7 lines 665 through
   668, link the breaker's threshold values in the action-items section
   so any threshold-policy revision routes through `write-rfc`.

## Stop conditions

- Halt when `/src/work/<day>/<task-id>/run.log.jsonl` is missing or empty; the
  postmortem cannot rest on a synthesized timeline. Route an inbox item
  rather than fabricate spans.
- Halt when `/src/work/<day>/<task-id>/run-summary.md` is missing on an abort
  trigger; the supervisor's PRD §7 line 890 invariant is broken and the
  postmortem MUST flag the gap before authoring narrative.
- Halt when the stub already exists at the target path; the published
  postmortem is immutable per PRD §8 line 949 and a re-author MUST route
  through a new `task-id`-suffixed addendum.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.
- Halt when the second-story rubric self-check flags a human-pointing
  phrase the skill cannot rewrite within 3 rounds; escalate via inbox per
  PRD §13 R29.

## Failure-handling

- If the run-log carries spans from more than one `task-id`, the skill
  MUST split the postmortem per `task-id` and emit one stub per id; a
  cross-id narrative defeats the citation grain.
- If an action item's owner persona does not yet exist (e.g., the action
  item asks `appsec` to revise a threshold but the persona has not landed
  pre-M3), the skill MUST stage the item with `owner: TBD-pending-<persona>`
  and route the dependency through the inbox rather than drop the item.

## Cost guards

- Per-stub token budget defaults to 24 000 tokens across all 7 sections.
  A budget exhaustion mid-author MUST trip the breaker and route an
  inbox item; the skill MUST NOT silently truncate the second-story
  narrative.
- The stub SHALL stay at most 2000 words; long-form analysis routes
  through the M4+ `incident-response` pipeline per PRD §7 line 710 with
  the supervisor's stub as the seed input.
