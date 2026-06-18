# Operator section
- 👀 **In this file:** Operator Output Contract — Chat Completion Shape
- ⚖️ **Why it matters:** Quick orientation for Operator Output Contract — Chat Completion Shape before agents load the full contract.
- 🧭 **See also:**
  - kind: file
  - kind: file
  - /AGENTS.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Operator Output Contract — Chat Completion Shape
slug: operator-output-contract
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [supervisor, tech-writer, librarian]
purpose: |
  The canonical format every agent SHALL use for operator-visible chat/stdout
  output when a bounded task completes.
references:
  - kind: file
    path: AGENTS.md
    note: "AGENTS §7 binds operator-facing completion output to this contract."
  - kind: file
    path: lib/memory/handbook/operator-agent-artifact-format.md
    note: "Defines the file-level operator/agent section split."
related:
  - /AGENTS.md
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/memory/handbook/output-manifest-contract.md
  - /lib/memory/handbook/pancreator-config.md
---

# Operator Output Contract — Chat Completion Shape

Every operator-visible agent response at a bounded task boundary MUST use the
shape in this document. The goal is fast human triage: status first, summary
second, changed surfaces third, and exact next actions last.

## 1 — Required fields

Every completion response MUST include these fields in this order:

1. **Action status**
2. **Brief summary**
3. **Files added or changed**
4. **Deleted files**
5. **Next operator actions**

Use `N/A` as the value when a field has no content. Do not omit the field.

## 2 — Canonical Markdown shape

````markdown
✅ **Action status:** Success | Partial Success | Fail

🧾 **Brief summary:** <one to three sentences>

📝 **Files added or changed:**
- [path/or/directory](<clickable link>)
- [path/or/directory](<clickable link>)

🗑️ **Deleted files:** N/A

🧭 **Next operator actions:**
- <brief action summary>
  ```bash
  <exact command with exact syntax and arguments>
  ```
- <brief agent invocation>
  ```text
  /persona-name <exact prompt>
  ```
````

Agents MAY add short supporting sections before this block only when the operator
needs context to interpret the result. The canonical fields above MUST remain
present and easy to scan.

## 3 — Action status values

`Action status` MUST be exactly one of:

- `Success` — requested work completed and validation did not reveal a blocker.
- `Partial Success` — useful work was completed, but some requested scope,
  migration, validation, or external action remains incomplete.
- `Fail` — no useful requested work was completed or the result should not be used.

Agents MUST NOT use synonyms such as "done", "blocked", "mostly done", or
"warning". Put nuance in the brief summary and next actions.

## 4 — Brief summary

The brief summary MUST be one to three sentences. It SHOULD state:

- what changed;
- any material limitation; and
- the validation outcome when validation ran.

Do not paste raw logs. Link or name the artifact when details are available in a
file.

## 5 — Files added or changed

`Files added or changed` MUST list repo paths as clickable Markdown links when
the output medium supports links.

Rules:

- List each changed file unless every file in a directory was changed.
- If every file in a directory was changed, list only that directory.
- Prefer branch-aware links for GitHub-backed work.
- Use repo-relative link labels.
- Use `N/A` when no files were added or changed.
- Do not list deleted files here; use **Deleted files**.

Example:

```markdown
📝 **Files added or changed:**
- [AGENTS.md](https://github.com/alenlukic/pancreator/blob/<branch>/AGENTS.md)
- [pancreator/lib/memory/handbook/](https://github.com/alenlukic/pancreator/tree/<branch>/pancreator/lib/memory/handbook)
```

## 6 — Deleted files

`Deleted files` MUST list repo paths as newline-separated bullets, preferably
with clickable links to the deletion diff or compare view when available. Use
`N/A` when no files were deleted.

## 7 — Next operator actions

`Next operator actions` MUST be a bullet list. Each bullet MUST contain:

- a brief action summary; and
- exact steps to take.

When commands are involved, include the exact command in a fenced `bash` block.
When agent invocation is involved, include the persona name and exact prompt in a
fenced `text` block.

### 7.1 — Command specificity

This workspace does not expose bare `pan` on the shell `PATH`. Runnable `pan`
commands MUST use this workspace form from the repository root:

```bash
pnpm -w exec pan <subcommand> [arguments...]
```

Every `git add`, `git commit`, `pnpm`, and `pan` line MUST list exact paths,
flags, and arguments. Agents MUST NOT say "stage the touched files", "run the
usual tests", "commit the changes", or "etc." when exact commands can be known.

When a command needs environment variables, include them in the command block.

### 7.2 — Agent invocation specificity

Agent invocation steps MUST name the persona and include the prompt:

```text
/reviewer Review pancreator/.pan/work/<day>/<task-id>/implementation.md against PERSONA.REVIEWER and DOC.OUTPUT_MANIFEST.
```

Do not tell the operator to "ask the reviewer" without a copy-pasteable prompt.

## 8 — Repo-change completion requirements

For repo-change tasks, the completion MUST state:

- what changed;
- validation actually run;
- validation not run; and
- any patch, script, branch, or PR artifact produced.

If validation could not run because the agent was using the GitHub connector or
another non-local tool, say so directly. Do not imply tests ran.

## 9 — Relationship to output manifests

`DOC.OUTPUT_MANIFEST` remains the machine-checkable receipt inside durable
artifacts. This contract governs operator-visible chat/stdout output. When both
are present, the chat output MAY summarize the manifest, but it MUST still include
the five fields required by this document.

## 10 — Prohibited content

Operator output MUST NOT:

- omit a required field;
- use non-clickable file names when clickable links are available;
- hide failed or skipped validation;
- claim a file was changed, deleted, moved, or tested unless current repo state
  proves it;
- offload automatable shell work to the operator when the completing agent could
  perform it during the task; or
- suggest `git push`, `git commit --no-verify`, `gh pr create`, or merge actions
  unless an explicit persona contract and operator ratification allow it.
