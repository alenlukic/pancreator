# Shepherd a pull request

Use when the operator invokes `/pan-shepherd` on one GitHub pull request and
`SHEPHERD-001` is active.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Principle

Review feedback on an open pull request arrives on its own schedule, from humans
and from review bots.

The shepherd watches one PR so the operator does not have to.
It first clears the feedback already on the PR, then collects new feedback until the PR goes quiet.
It judges each item against the code and the author's own review history, and implements only what survives that judgment.
It gates every change through a scoped review squad, pushes the reviewed result to the PR branch, and answers every item it decided.
Then it watches again.

The shepherd is a filter, not a relay. Feedback becomes a change only after the
shepherd verifies the claim in the code and clears it against the ledger.
A rejected item with a stated reason is a correct outcome.

## Vocabulary

- **Poll cycle** — one read of every feedback surface, followed by a wait of
  about 60 seconds.
- **Watch window** — one run of poll cycles: at least 15, extended past 15 only
  by the quiescence rule below.
- **Feedback batch** — the new items a window collected, closed at quiescence.
  **Batch 0** is the feedback that already existed when the command ran.
- **Ledger** — the durable per-session record of every feedback item, its
  decision, and the reply that answered it, at
  `runtime/logs/sessions/<session-id>/shepherd-ledger.jsonl`.
- **Decision table** — the operator-facing view of the ledger, one row per item.

## Session setup

1. Resolve the operator's PR reference:
   `gh pr view <ref> --json number,url,state,headRefName,baseRefName`. Stop and
   report when the PR is closed or merged, or when `gh` cannot reach it.
2. Confirm the workspace is on the PR head branch with no uncommitted changes
   that the shepherd did not make. Check out the head branch when the operator
   directed it. Otherwise stop and report the mismatch.
3. Confirm that no mutating workflow agent runs against the same workspace.
4. Create the session ledger. Seed it with every feedback item that already
   exists on the PR, in window `0`:
   - An item on a resolved review thread, or one the PR author already answered
     in a reply, is `history`. It gives bot discipline its context and gets no
     decision, no reply, and no table row.
   - Every other item is `open` and forms batch 0.
   - When the operator directed the session to watch new feedback only, seed
     every existing item as `history` and leave batch 0 empty.
5. Record the head commit SHA. Every later push is measured from it.

## Feedback surfaces

One poll cycle reads all three surfaces and keeps only items newer than the last
seen item on each:

- Reviews: `gh api repos/{owner}/{repo}/pulls/{number}/reviews`
- Inline review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments`
- Conversation comments: `gh api repos/{owner}/{repo}/issues/{number}/comments`

A CI status, a label, or an edit to the PR body is not feedback. The shepherd's
own commits are not feedback, and neither is any comment whose id the ledger
records as a shepherd reply. The shepherd posts under the operator's GitHub
identity, so the author login alone cannot tell its replies apart.

## The loop

1. Clear batch 0 before the first window: assess, implement, review, push, and
   reply exactly as for any other batch. An empty batch 0 skips straight to the
   first window. A fully rejected batch 0 gets its replies and does not end the
   session. Batch 0 does not count against the window limit.
2. Open a watch window. A session runs at most **8** windows.
3. Run poll cycles. Append every new item to the ledger as `open` when it
   arrives.
4. Close the window at **quiescence**: the window has run its 15 cycles, and at
   least one full cycle passed with no new item.
   Feedback in cycle 15 or later thus extends the window.
   A window with feedback never ends on a cycle that produced any.
5. An empty batch — 15 cycles, no feedback — ends the session.
6. A non-empty batch goes to assessment. When every item in the batch is
   rejected, post the replies and end the session. Otherwise implement, review,
   push, and reply, then open the next window. When this was the eighth window,
   end the session instead.

The session also ends when the PR is closed or merged externally, when three
consecutive poll cycles fail to reach GitHub, or when a batch fails the
implement-and-review bound below. Every ending produces the final report.

## Assessment

Judge each `open` item in the batch and record a decision before any
implementation begins:

- **accepted** — the claim is verified against the current code, the fix is
  inside the PR's scope, and it does not contradict an operator directive or a
  prior recorded decision. It becomes **actioned** once the push that carries
  its fix lands.
- **rejected** — the claim rests on a wrong assumption or wrong reasoning, the
  fix falls outside the PR's scope, the risk does not justify the change, or bot
  discipline bars it. A real problem outside the PR's scope is rejected on scope,
  and the final report lists it as a follow-up. The reason is recorded.

Verify before you accept: read the code the item points at, and reproduce the
claimed defect where a cheap check exists.

An item that needs an operator decision goes to the operator: a question put to
the PR author, or a scope call only the operator can make.
Ask through the question tool, and do not answer on the operator's behalf.
The operator's answer decides the item.

Weight a human maintainer's comment above a bot's, but the same verification
applies to both.

## Bot discipline

A review bot has no memory and no accountability. The ledger supplies both.
Before judging any bot item, re-read that bot's ledger history on this PR and
check, in order:

1. **Repetition.** Semantically the same as an item already decided:
   re-apply the prior decision and reason. Do not re-litigate.
2. **Self-contradiction.** The bot contradicts its own earlier feedback: reject
   the newer item unless verification shows the newer claim right and the older
   one wrong, and record the contradiction either way.
3. **Induced finding.** The bot flags code that exists only because the
   shepherd implemented that bot's earlier accepted item: do not revert.
   Reject and record as thrash — unless verification shows a genuine defect in
   the shepherd's implementation, which is fixed forward.
4. **Inter-bot conflict.** Two bots demand incompatible changes: judge on the
   merits against the code, accept at most one side, and record the conflict
   and the losing side's reason.

The shepherd MUST NOT implement and later revert the same edit within a
session. The second reversal request is rejected as thrash and escalated in the
final report.

Each item gets exactly one reply.
The shepherd MUST NOT answer a reply to its reply with further argument.
A new claim in that reply is a new item.

## Implement and review

1. Implement the accepted items as the smallest coherent change, with
   proportionate automated tests under the engineering guidance in the card.
2. Capture the diff against the last pushed SHA to a file under the session
   directory.
3. Select the review dimensions for this batch, as the next section states.
4. Delegate one `pan-shepherd-reviewer` subagent with: the captured diff path,
   the repository root as the review workspace path, an intent brief listing
   each accepted item and why it was accepted, the ledger path, and the
   dimension selection.
5. The subagent runs exactly the selected dimensions per
   `library/skills/review-squad.md`. It returns a ranked finding set with a pass
   or fail verdict for those dimensions, and edits nothing. Its model comes from
   the `shepherd-reviewer` mapping in `config.json`.
6. On fail, repair the blocking findings and re-review the delta with the same
   selection. A repair that reaches a surface outside the selection widens it
   for the re-review, with the reason recorded.
7. A batch gets at most **3** implement-review iterations. A batch still
   failing after the third ends the session with nothing pushed and the failure
   in the report.
8. On pass, commit with a message naming the actioned items, and push to the PR
   head branch. Never force-push, never another branch, never a merge.
9. Mark each accepted item `actioned` with the pushed commit SHA, then reply.

## Dimension selection

The shepherd does not run the whole squad by default.
It scopes each batch's review to the dimensions that batch could affect.

- With an operator selection on the card, use exactly that set for every batch.
- Otherwise start from the default lineup the card records.
- Keep a dimension only when a defect in this change under that dimension could
  carry a material consequence for the PR's scope.
- Leave out a dimension the change cannot reach. For example, a copy fix in one
  test file does not need security or operations.
- Add a conditional dimension only when the diff touches its surface.
- Keep at least one dimension.
- Record the selection in the ledger with one reason for each dimension left
  out.

## Replies

Every decided item gets one reply on the PR. Post rejection replies once the
batch's decisions are recorded, and `Fixed in` replies only after the push that
carries the commit.

- An inline review comment gets its reply in its own thread:
  `gh api -X POST repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies -f body=<reply>`.
- A review body or a conversation comment has no thread. Answer all such items
  in one batch conversation comment through
  `gh api -X POST repos/{owner}/{repo}/issues/{number}/comments -f body=<reply>`,
  one line per item: a link to the item, then its reply.
- Record every reply's comment id and URL in the ledger before the next poll
  cycle, so the next cycle does not read it as feedback and a resumed session
  does not post it twice.

Reply text:

- **Actioned:** exactly `Fixed in <sha>`, with the pushed commit's SHA.
- **Rejected:** one or two short sentences that name the flaw in the feedback's
  assumptions or reasoning, the PR's scope, or the risk assessment. State the
  fact that decides it, for example
  `The caller already validates this input in parseRequest, so this path never receives null.`
  or `Out of scope for this PR, which only renames the config key.`

A reply follows the writing rules of `COMMS-001`. A reply MUST NOT:

- elaborate past the deciding reason, or restate the feedback.
- expose the shepherd's reasoning process, its tools, or its ledger.
- refer to the PR author in the third person. Write in the first person, or
  state the fact impersonally.
- @mention any user, human or bot.
- thank, apologize, hedge, or add a closing aside.

## Decision table

The decision table is the operator's live view of the ledger. It has one row per
`open`, `accepted`, `actioned`, or `rejected` item, in arrival order:

| Reviewer | Timestamp | Comment | Decision | Detail |
| -------- | --------- | ------- | -------- | ------ |

- **Reviewer** — the display name of the author, such as `Devin` or
  `CodeRabbit`, or the login when no name exists.
- **Timestamp** — the item's creation time.
- **Comment** — a link to the item.
- **Decision** — `open`, `awaiting operator`, `accepted`, `actioned`, or
  `rejected`.
- **Detail** — the commit SHA for an actioned item, the rejection reason for a
  rejected item, and empty otherwise.

Post the refreshed table to operator chat each time a row is added or changes:
when an item arrives, when a batch is decided, when a push lands, and when an
item goes to the operator. Render it from the ledger, never from memory.

## Final report

Every session ends with one operator-facing report. It holds:

- the PR, its branch, and the windows used.
- the final decision table.
- the pushes made, with SHAs.
- the review iterations spent, the dimensions each review ran, and the reason
  for each dimension it left out.
- the rejected out-of-scope items to follow up.
- the recorded bot contradictions, conflicts, and thrash.
- the ledger path.

An accepted item whose batch never passed review is reported as not actioned,
with the failure.
Missing evidence is reported as missing, not filled in.

## Ledger shape

One JSON object per line, appended, never rewritten:

```json
{
  "id": "<surface>:<numeric id>",
  "surface": "review|review_comment|issue_comment",
  "author": "<login>",
  "author_name": "<display name, or the login>",
  "author_type": "human|bot",
  "created_at": "<ISO 8601>",
  "url": "<html URL of the item>",
  "window": 3,
  "summary": "<one sentence, the claim itself>",
  "disposition": "history|open|awaiting_operator|accepted|actioned|rejected",
  "rationale": "<required for accepted and rejected>",
  "commit": "<pushed commit SHA, required for actioned>",
  "reply": { "id": "<comment id>", "url": "<reply URL>" },
  "related": ["<ledger ids this item repeats, contradicts, or conflicts with>"]
}
```

A changed item gets a new line rather than an edit, so the ledger reads as
history. A batch's review adds one line of its own:

```json
{
  "id": "review:<window>:<iteration>",
  "window": 3,
  "dimensions": ["correctness", "simplification"],
  "left_out": { "security": "<reason>", "operations": "<reason>" },
  "selected_by": "operator|shepherd",
  "verdict": "pass|fail"
}
```

## Boundaries

- Invocation of `/pan-shepherd` authorizes commits and pushes to the shepherded
  PR's head branch only, and only for changes the review squad passed. It also
  authorizes one reply to each decided item.
- The shepherd MUST NOT merge, close, retarget, or rebase the PR, and MUST NOT
  push to any other branch or force-push. It MUST NOT post any other PR comment
  unless the operator directed it.
- The shepherd MUST NOT create, advance, or write state for a workflow run.
- Every item outside `history` MUST hold a final decision before the session
  ends.
- A batch's changes MUST NOT be pushed before its review passes.
