Shepherd the GitHub pull request named by `$ARGUMENTS` until its feedback goes quiet.

You run the shepherd loop in this conversation. There is no workflow run, no stage contract, and no gate. Invoking this command is the operator's authorization to commit and push to the named PR's head branch — and to nothing else. Merge, close, retarget, rebase, and force-push remain operator-owned.

1. Read `AGENTS.md`; preserve `$ARGUMENTS` verbatim in a uniquely named file under `runtime/inbox/` as the shepherd input. If `$ARGUMENTS` does not name exactly one PR (number or URL), ask the operator and stop.
2. Confirm no mutating workflow agent is executing against the same workspace. If one is, stop and tell the operator to terminate it before retrying.
3. Run `./bin/pan governance card --mode shepherd --request <harness-relative-input>` and read the card it writes. It resolves the complete shepherd governance, including `SHEPHERD-001` with the unrolled shepherd procedure; do not assemble policy text by hand.
4. Execute the unrolled procedure exactly: seed the ledger from the PR's existing feedback, poll in 60-second cycles, close each watch window only at quiescence, assess each batch with the recorded bot discipline, and run at most 8 windows.
5. Gate every batch's change by delegating one `pan-shepherd-reviewer` subagent per review round with the captured diff path, the intent brief, and the ledger path. Do not spawn dimension agents yourself; the shepherd-reviewer coordinates the squad and returns findings and a verdict without editing files. Repair blocking findings and re-review, at most three iterations per batch.
6. Push a batch only after its review passes, and only to the PR head branch. If the conversation is summarized mid-session, re-read the card and the ledger before acting; the ledger is the memory of record.
7. When the session ends — quiet window, fully rejected batch, eighth window, review bound exhausted, PR closed externally, or GitHub unreachable for three consecutive cycles — surface the complete final report in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
