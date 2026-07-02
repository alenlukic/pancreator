Resume or advance Pancreator run `$ARGUMENTS`.

1. Read `AGENTS.md` and run `./bin/pan status $ARGUMENTS --json`.
2. Repeat until stop condition:
   - `prepare_invocation` -> run `./bin/pan prepare`, read card, continue loop.
   - `invoke_agent` -> read `invocations/<invocation-id>.md`, paste its full contents verbatim into the subagent `prompt` (Task tool `prompt` field; path-only references MUST NOT substitute), persist the same text to `.delegation.md`, submit output, continue loop.
   - `supervisor_assessment` -> write assessment JSON, run `./bin/pan assess`, continue loop.
   - `operator_approval` -> if the current operator request already supplies an explicit approval or rejection, execute it; otherwise present the ratification packet and STOP.
   - `operator_decision` -> if the current operator request already supplies an explicit decision, execute it; otherwise present the pause context/options and STOP.
   - `none` -> report terminal state and STOP.
3. After each action, show status, outcome, evidence pointers, and the next required action.
