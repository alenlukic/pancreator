# Cursor prompt context probe

## Purpose

This probe determines whether Cursor injects context returned by a
`beforeSubmitPrompt` project hook. It also records the complete payload that
Cursor sends to the hook.

## Procedure

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
