Shepherd the GitHub pull request named by `$ARGUMENTS` until its feedback goes quiet.

You run the shepherd loop in this conversation. There is no workflow run, no stage contract, and no gate. Invoking this command authorizes commits and pushes to the named PR's head branch. It also authorizes one reply to each feedback item you decide, and nothing else. Merge, close, retarget, rebase, and force-push remain operator-owned.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Preserve `$ARGUMENTS` verbatim in a uniquely named file under `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/queue/` as the shepherd input.
   - Parse `$ARGUMENTS` for one optional `--dimensions <a,b,c>` selection, a comma-separated list of review dimension slugs, and one optional `--worktree <name>`. Write the list with no spaces. Everything else names the PR.
   - If the rest does not name exactly one PR (number or URL), ask the operator and stop.
2. Confirm no mutating workflow agent runs against the same workspace. If one runs, stop and tell the operator to end it before retrying.
3. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode shepherd --request <harness-relative-input>` and read the card it writes. It resolves the complete shepherd governance, including `SHEPHERD-001` and its reference to the shepherd procedure. Do not assemble policy text by hand.
   - When the operator passed `--dimensions`, add `--dimensions <a,b,c>` verbatim. The command refuses an unknown slug and names the accepted list. Surface that error to the operator and stop.
   - When the operator names a worktree, add `--worktree <name>` to create or resolve it. The card then binds the session workspace to that worktree.
4. Read the referenced procedure and run it exactly.
   - Seed the ledger from the PR's existing feedback. Clear that feedback as batch 0 before the first watch window, unless the operator said to watch new feedback only.
   - Then poll in 60-second cycles and close each watch window only at quiescence. Assess each batch with the recorded bot discipline, and run at most 8 windows.
5. Decide every item as actioned, with the pushed commit SHA, or rejected, with its reason. Keep the decision table the procedure defines. Post the refreshed table to this chat each time a row is added or changes.
6. Gate every batch's change through one `pan-shepherd-reviewer` subagent per review round.
   - Pass it the captured diff path, the intent brief, the ledger path, and the dimension selection.
   - With an operator selection on the card, pass exactly that set for every batch.
   - Otherwise select, per batch, only the dimensions under which a defect in that change could carry a material consequence for the PR's scope. Record each dimension you left out with its reason.
   - Do not spawn dimension agents yourself. The shepherd-reviewer coordinates the selected dimensions and returns findings and a verdict without editing files. Repair blocking findings and re-review, at most three iterations per batch.
7. Push a batch only after its review passes, and only to the PR head branch. Then reply to each decided item on the PR as the procedure specifies: `Fixed in <sha>` for an actioned item, and one concise reason for a rejected one. Never @mention a user in a reply. If the conversation is summarized mid-session, re-read the card and the ledger before acting. The ledger is the memory of record.
8. The session ends at a quiet window, a fully rejected batch after batch 0, or the eighth window. It also ends at an exhausted review bound, a PR closed externally, or GitHub unreachable for three consecutive cycles. When the session ends, surface the complete final report in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
