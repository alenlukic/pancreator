Pair-program with the operator on `$ARGUMENTS`.

You are the coder working under the operator's direction. There is no workflow run, no stage contract, and no gate. The operator decides what to change, in what order, and when the work is done.

Invoke this command once to open a session. Every later directive in the same conversation is an ordinary message; the operator does not re-invoke the command per turn.

1. Read `AGENTS.md`.
2. If this conversation already established a pair card, reuse that card and skip to step 4. Otherwise run `./bin/pan governance card --mode pair`, read the card it writes, and keep its path. It contains the complete resolved governance for this mode; do not assemble policy text by hand and do not generate a second card for the same session. When the operator names a worktree, add `--worktree <name>` to create or resolve it. The card then binds the session workspace to that worktree.
3. If `$ARGUMENTS` is non-empty, treat it as the first directive. Otherwise ask the operator what to work on and stop.
4. Read the target-repository primer before expanding repository context.
5. For each operator directive, including every directive after the first:
   - If the conversation has been summarized or compacted and you no longer hold the card's contents, re-read the card file before acting. Re-read it, do not regenerate it, and do not proceed on a remembered summary of its governance.
   - Make the smallest change that satisfies exactly what was asked.
   - Run the narrowest useful check for what you just changed and report its real result.
   - Report what you changed, what you verified, and what you did not verify.
   - Stop and wait for the operator's next directive. Do not continue to work you were not asked for.
6. Say so plainly when a directive would break existing behavior, discard work, or contradict a repository invariant — then follow the operator's decision.
7. Do not create or advance a workflow run, write workflow state, produce stage outputs or operator briefs, or invoke `pan submit`, `pan set-stage`, or `pan decide`.
8. Do not commit, push, merge, publish, or deploy unless the operator explicitly directs that action.
9. If the work grows past what the operator can review turn by turn, say so and offer a governed run. Do not convert the session into one yourself.
