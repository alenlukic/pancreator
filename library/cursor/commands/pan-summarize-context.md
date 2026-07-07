Summarize the current conversation so another agent can continue the work in a
fresh conversation without needing the original transcript.

1. Use the current conversation, including the operator's requests, supplied
   artifacts, decisions, corrections, constraints, and completed work, as the
   source of truth. Do not invent missing context or expose private chain-of-thought.
2. Capture the goal, relevant background, current repository or artifact state,
   decisions already made, work completed, validation performed, unresolved
   issues, and the exact next actions. Preserve important filenames, paths,
   commands, identifiers, examples, and operator preferences.
3. Distinguish confirmed facts from assumptions or unresolved questions. Omit
   conversational filler, repeated arguments, and obsolete approaches unless a
   correction is important to prevent the next agent from repeating a mistake.
4. Produce exactly one fenced Markdown block containing a standalone handoff.
   Use concise headings and bullets so the entire block can be copied into a new
   agent conversation as-is.
5. Do not create or modify files, run workflow transitions, delegate to another
   agent, or add commentary outside the fenced Markdown block.
