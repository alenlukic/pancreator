Augment an operator prompt so one agent can execute it in one shot with full
intent. The output is text in this conversation. This command changes no file,
starts no run, and delegates nothing.

1. Parse `$ARGUMENTS`:
   - When `--r` appears, remove it and treat this invocation as a refinement
     pass.
   - When `--c` appears, treat the text after `--c` as augmentation context
     and the text before it as the prompt. The context value can be inline
     instructions, a file path, a directory path, or a URL.
   - Otherwise treat all of `$ARGUMENTS` as the prompt.
   - On a refinement pass, treat the prompt text as refinement directives
     against the most recent augmented prompt in this conversation. Stop and
     ask the operator when this conversation holds no earlier augmented
     prompt.
2. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md` and
   `{{PANCREATOR_HARNESS_PATH}}library/skills/prompt-augmentation.md`. Apply
   the skill to every later step.
3. Resolve the context value with the skill's context rules. When the prompt
   or the context references target-repository code, read
   `{{PANCREATOR_HARNESS_PATH}}docs/target-repo-primer.md` first.
4. Compose the augmented prompt with the skill's composition rules. Preserve
   every operator constraint. Ground terms in the harness and repository
   vocabulary. Make the deliverable and its verification explicit.
5. Output exactly one fenced Markdown block that holds the complete augmented
   prompt. The operator must be able to paste it without edits. After the
   block, list assumptions and interpretation decisions in at most five short
   bullets.
6. Do not create or modify files, do not start or advance a workflow run, do
   not delegate to another agent, and do not execute the augmented prompt
   yourself.
