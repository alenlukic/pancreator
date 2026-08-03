# Shepherd a pull request

Use when the operator invokes `/pan-shepherd` on one GitHub pull request and
`SHEPHERD-001` is active.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Principle

Review feedback on an open pull request arrives on its own schedule, from humans
and from review bots. The shepherd watches one PR so the operator does not have
to: it collects feedback until the PR goes quiet, judges each item against the
code and against the author's own review history, implements only what survives
that judgment, gates every change through the local review squad, and pushes the
reviewed result back to the PR branch. Then it watches again.

The shepherd is a filter, not a relay. Feedback becomes a change only after the
shepherd has verified the claim in the code and cleared it against the ledger.
An unactioned item is not a failure; a rejected item with a recorded reason is a
correct outcome.

## Vocabulary

- **Poll cycle** — one read of every feedback surface, followed by a wait of
  about 60 seconds.
- **Watch window** — one run of poll cycles: at least 15, extended past 15 only
  by the quiescence rule below.
- **Feedback batch** — the new items a window collected, closed at quiescence.
- **Ledger** — the durable per-session record of every feedback item and its
  disposition, at `runtime/logs/sessions/<session-id>/shepherd-ledger.jsonl`.

## Session setup

1. Resolve the operator's PR reference:
   `gh pr view <ref> --json number,url,state,headRefName,baseRefName`. Stop and
   report when the PR is closed or merged, or when `gh` cannot reach it.
2. Confirm the workspace is on the PR head branch with no uncommitted changes
   that the shepherd did not make. Check out the head branch when the operator
   has directed it; otherwise stop and report the mismatch.
3. Confirm no mutating workflow agent is executing against the same workspace.
4. Create the session ledger. Seed it with every feedback item that already
   exists on the PR, marked `preexisting`. Preexisting items are history for
   bot-discipline checks; the shepherd MUST NOT action them unless the operator
   asked for that explicitly.
5. Record the head commit SHA. Every later push is measured from it.

## Feedback surfaces

One poll cycle reads all three surfaces and keeps only items newer than the last
seen item on each:

- Reviews: `gh api repos/{owner}/{repo}/pulls/{number}/reviews`
- Inline review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments`
- Conversation comments: `gh api repos/{owner}/{repo}/issues/{number}/comments`

A CI status, a label, or an edit to the PR body is not feedback. The shepherd's
own comments and commits are not feedback.

## The loop

1. Open a watch window. A session runs at most **8** windows.
2. Run poll cycles. Append every new item to the ledger as `open` when it
   arrives.
3. Close the window at **quiescence**: the window has run its 15 cycles, and at
   least one full cycle has passed with no new item. Feedback in cycle 15 or
   later therefore extends the window; a window with feedback never ends on a
   cycle that produced any.
4. An empty batch — 15 cycles, no feedback — ends the session.
5. A non-empty batch goes to assessment. When every item in the batch is
   rejected or deferred, the session ends. Otherwise implement, review, and
   push, then open the next window; when this was the eighth window, end the
   session instead.

The session also ends when the PR is closed or merged externally, when three
consecutive poll cycles fail to reach GitHub, or when a batch fails the
implement-and-review bound below. Every ending produces the final report.

## Assessment

Judge each `open` item in the batch and record a disposition before any
implementation begins:

- **accepted** — the claim is verified against the current code, the fix is
  inside the PR's scope, and it does not contradict an operator directive or a
  prior recorded disposition.
- **rejected** — the claim is wrong, moot, out of scope, style preference
  without a failure scenario, or barred by bot discipline. The rationale is
  recorded.
- **deferred** — real but outside this PR's scope. Deferred items go to the
  final report, not to the diff.

Verify before you accept: read the code the item points at, and reproduce the
claimed defect where a cheap check exists. A question addressed to the operator
is deferred, not answered on their behalf. Weight a human maintainer's comment
above a bot's, but the same verification applies to both.

## Bot discipline

A review bot has no memory and no accountability; the ledger supplies both.
Before judging any bot item, re-read that bot's ledger history on this PR and
check, in order:

1. **Repetition.** Semantically the same as an item already dispositioned:
   re-apply the prior disposition and rationale. Do not re-litigate.
2. **Self-contradiction.** The bot contradicts its own earlier feedback: reject
   the newer item unless verification shows the newer claim right and the older
   one wrong, and record the contradiction either way.
3. **Induced finding.** The bot flags code that exists only because the
   shepherd implemented that bot's earlier accepted item: do not revert.
   Reject and record as thrash — unless verification shows a genuine defect in
   the shepherd's implementation, which is fixed forward.
4. **Inter-bot conflict.** Two bots demand incompatible changes: judge on the
   merits against the code, accept at most one side, and record the conflict
   and the losing side's rationale.

The shepherd MUST NOT implement and later revert the same edit within a
session. The second reversal request is rejected as thrash and escalated in the
final report. The shepherd MUST NOT post PR comments arguing with a bot, and
MUST NOT post any PR comment unless the operator directed it.

## Implement and review

1. Implement the accepted items as the smallest coherent change, with
   proportionate automated tests under the engineering guidance in the card.
2. Capture the diff against the last pushed SHA to a file under the session
   directory.
3. Delegate one `pan-shepherd-reviewer` subagent with: the captured diff path,
   an intent brief listing each accepted item and why it was accepted, and the
   ledger path. It coordinates the review squad per `library/skills/review-squad.md`
   and returns a ranked finding set with a pass or fail verdict. It edits
   nothing. Its model comes from the `shepherd-reviewer` mapping in
   `config.json`, so the squad's model is configured independently of the
   run-time reviewer.
4. On fail, repair the blocking findings and re-review the delta. A batch gets
   at most **3** implement-review iterations; a batch still failing after the
   third ends the session with nothing pushed and the failure in the report.
5. On pass, commit with a message naming the actioned items, and push to the PR
   head branch. Never force-push, never another branch, never a merge.

## Final report

Every session ends with one operator-facing report: PR and branch, windows
used, each batch with per-item dispositions and rationales, pushes made with
SHAs, review iterations spent, deferred items, recorded bot contradictions,
conflicts, and thrash, and the ledger path. Missing evidence is reported as
missing, not filled in.

## Ledger shape

One JSON object per line, appended, never rewritten:

```json
{
  "id": "<surface>:<numeric id>",
  "surface": "review|review_comment|issue_comment",
  "author": "<login>",
  "author_type": "human|bot",
  "created_at": "<ISO 8601>",
  "window": 3,
  "summary": "<one sentence, the claim itself>",
  "disposition": "preexisting|open|accepted|rejected|deferred",
  "rationale": "<required for every disposition except open>",
  "related": ["<ledger ids this item repeats, contradicts, or conflicts with>"]
}
```

A dispositioned item gets a new line rather than an edit, so the ledger reads
as history.

## Boundaries

- Invocation of `/pan-shepherd` authorizes commits and pushes to the shepherded
  PR's head branch only, and only for changes the review squad has passed.
- The shepherd MUST NOT merge, close, retarget, or rebase the PR, and MUST NOT
  push to any other branch or force-push.
- The shepherd MUST NOT create, advance, or write state for a workflow run.
- Every feedback item MUST hold a ledger disposition before the session ends.
- A batch's changes MUST NOT be pushed before its review passes.
