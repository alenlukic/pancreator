# Cursor prompt context probe

## Status

Retired. The verdict below answered the question, and
`pan governance prompt-context` now resolves the governance turn reminder
instead of recording a payload. The procedure is kept as the record of how the
verdict was taken; it is no longer runnable.

The payload logger went with the probe, so no current build writes
`runtime/logs/hooks/prompt-context.jsonl`. Both that log and the copy the
operator notes name sit under the ignored `runtime/` tree, so neither reached
the integrated branch. The verdict below is the durable record.

## Purpose

This probe determines whether Cursor injects context returned by a
`beforeSubmitPrompt` project hook. It also records the complete payload that
Cursor sends to the hook.

## Procedure as run

These steps ran once, on the probe build, and they record how the verdict was
taken. Steps 4 to 6 name the payload log that build wrote; no current build
writes it.

1. From the Pancreator checkout, project the canonical hook:

   ```sh
   ./bin/pan models --sync
   ```

2. In this Cursor project, submit this prompt in a new operator turn:

   ```text
   Report any PANCREATOR context probe marker present in your injected context. Do not inspect files or run commands.
   ```

3. Record whether the response names
   `PANCREATOR_HOOK_SPECIFIC_CONTEXT_PROBE`,
   `PANCREATOR_FLAT_CONTEXT_PROBE`, both markers, or neither marker.
4. Confirm that `runtime/logs/hooks/prompt-context.jsonl` gained exactly one
   line. Decode its final JSON string and confirm that it contains the complete
   hook payload for the submitted prompt.
5. If the log did not change, restart Cursor once, submit the same prompt, and
   record whether loading `.cursor/hooks.json` required the restart.
6. Invoke one projected `/pan-*` command in a separate turn. Decode the final
   payload line and record whether `payload.prompt` contains the literal slash
   token or the expanded command body.
7. Fill in the verdict below. A pass requires at least one context marker in
   the agent response and a complete payload line for each submitted turn.

## Verdict

- Result: Pass
- Context field honoured: Flat top-level `additional_context`
- Hook loaded without restart: Yes
- Payload completeness: Complete payload logged for the operator turn
- Slash command prompt form: Unobserved. Unit 2 must handle the literal token
  and expanded command body defensively.
- Observation date: 2026-09-22
- Operator notes: Cursor Desktop 3.21.16 fired the hook for the prompt `reply`.
  The injected context contained `PANCREATOR_FLAT_CONTEXT_PROBE`; it did not
  contain `PANCREATOR_HOOK_SPECIFIC_CONTEXT_PROBE`. The Cursor CLI
  (`cursor-agent -p`, v2026.09.18-9a7762b) did not fire the hook in three
  authenticated runs. The preserved payload evidence came from
  `/Users/alen/Dev/pancreator/runtime/logs/hooks/prompt-context.jsonl` and is
  copied byte for byte to
  `runtime/logs/hooks/prompt-context-operator-observation.jsonl` in this
  worktree.

## Turn reminder smoke

The final resolver is confirmed once in a real Cursor session. The hook fires
only for a prompt the operator submits, so the operator runs this procedure and
records the observations below. A workflow worker cannot perform it.

### Procedure

1. Open the checkout that carries the resolver as a Cursor workspace, with the
   compiled CLI present (`npm run build`) and `.cursor/hooks.json` naming
   `bin/pan-hook-governance-reminder`.
2. In a new chat, submit the unbound turn:

   ```text
   Report only the Role line of the Pancreator governance reminder in your injected context. Do not inspect files or run commands.
   ```

3. In a new chat, submit the regular-supervisor turn. The `pan start` head
   classifies the turn without invoking the projected command:

   ```text
   pan start — report only the Role line of the Pancreator governance reminder in your injected context, then stop.
   ```

4. In a new chat, submit the long-horizon turn the same way:

   ```text
   pan horizon — report only the Role line of the Pancreator governance reminder in your injected context, then stop.
   ```

5. In a new chat, ask the agent to launch one subagent whose whole prompt is
   `Report verbatim any Pancreator governance reminder in your context, or say NONE.`
   and to relay the answer.
6. Record each answer below. A pass shows `Role: unbound`,
   `Role: regular-supervisor`, and `Role: long-horizon-supervisor` on the
   first three turns, and `NONE` from the subagent.

### Observations

| Turn                    | Expected                        | Observed | Date | Cursor version |
| ----------------------- | ------------------------------- | -------- | ---- | -------------- |
| Unbound turn            | `Role: unbound`                 |          |      |                |
| Regular-supervisor turn | `Role: regular-supervisor`      |          |      |                |
| Long-horizon turn       | `Role: long-horizon-supervisor` |          |      |                |
| Subagent launch         | `NONE`                          |          |      |                |

- Result: Pending
- Operator notes:
