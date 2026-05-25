---
title: tess intake new <slug> — operator scaffolder for inbox directives
feature_id: tess-intake-scaffolder
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:12Z
references:
  - kind: path
    path: src/memory/handbook/inbox-lifecycle.md
    note: Defines the canonical {SID}_{HHMM}_{semantic}.md leaf layout and day-bucket naming.
  - kind: path
    path: src/memory/features/timestamp-naming-conventions/spec.md
    note: Defines SID = 86400 - secondsSinceMidnight and the HHMM wallclock encoding.
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/run.ts
    note: tess inbox today is read-only; there is no tess intake new.
  - kind: path
    path: src/inbox/in/
    note: Operators currently hand-author the day-bucket, the SID prefix, and the HHMM segment.
---

# tess intake new <slug> — operator scaffolder for inbox directives

## Problem

Dropping an intake directive today requires the operator to (a) compute
today's day-bucket (`<rfc-day>_<MM-DD-YY>`), (b) compute the SID prefix
(`86400 - secondsSinceMidnight`), (c) compute the HHMM wallclock encoding,
(d) author the YAML frontmatter (`title`, `feature_id`, `stage`, `owner`,
`status`, `created_at`, `references`), and (e) draft the body. Every step
is mechanical; every step is a documented contract. Yet none of them is
automated, so each new intake item risks drift from the inbox-lifecycle
contract.

## Goal

Ship a single operator command that drops a templated intake directive
into today's day-bucket with the correct prefix, HHMM, frontmatter, and
canonical body sections.

## Required outcomes

1. `tess intake new <slug> [--title "..."] [--owner intake-analyst]
   [--feature-id <id>] [--from-template <name>]` writes a new file at
   `src/inbox/in/<today-day-bucket>/<sid>_<hhmm>_<slug>.md`.
2. The command computes the day-bucket, SID, and HHMM from the local
   clock in UTC, exactly per the inbox-lifecycle contract.
3. The command refuses to overwrite an existing file and refuses to write
   into an archived day-bucket.
4. The default template includes the canonical frontmatter (`title`,
   `feature_id`, `stage: intake`, `owner: intake-analyst`,
   `status: open`, `created_at`, empty `references[]`) and the canonical
   body (`# <title>`, `## Problem`, `## Goal`, `## Required outcomes`,
   `## Acceptance criteria`, `## Out of scope`).
5. `--from-template` selects an alternate template under
   `src/memory/handbook/contract-templates/` for ratification requests,
   compliance-trigger directives, etc.

## Acceptance criteria

- `tess intake new my-thing --title "My thing"` produces a file whose
  path, frontmatter, and body all conform to
  `src/memory/handbook/inbox-lifecycle.md`.
- A vitest suite covers SID/HHMM computation across day boundaries and
  the day-bucket creation path.
- AGENTS.md §6 references the command as the canonical operator entry.
- The command exits non-zero with a clear hint when invoked without an
  initialized repository.

## Out of scope

- Editing existing inbox items (semantic immutability per
  `src/memory/handbook/inbox-lifecycle.md` §3b).
- Inbox archival (handled by the manual procedure or a separate
  `tess inbox archive` verb).
- MCP elicitation transport for intake (M2 scope).

## Recommended downstream owners

- `tech-lead` for the template contract under
  `src/memory/handbook/contract-templates/`.
- `coder` for the CLI verb and the SID/HHMM computation.
- `reviewer` for the day-boundary edge cases and overwrite-refusal audit.
