# Operator section
- 👀 **In this file:** Cursor command spec for `/introspect`.
- ⚖️ **Why it matters:** Scans recent agent and operator activity and turns recurring misses into an intake-ready follow-up item.
- 🧭 **See also:**
  - AGENTS.md
  - pancreator/lib/memory/handbook/agent-document-registry.md
  - pancreator/lib/memory/handbook/operator-output-contract.md
# Introspect

Run a bounded retrospective scan over recent Pancreator operator + agent activity and turn the findings into an intake-ready follow-up item.

## Authority and scope

- Treat `AGENTS.md` as the repo-wide authority before acting.
- Resolve and apply relevant handbook keys through `lib/memory/handbook/agent-document-registry.md` before judging misses. At minimum, consult the docs governing persona contracts, output manifests, inbox lifecycle, context economy, pipeline gates, and operator output contracts when present.
- Do not modify indexed source files. This command may write only local runtime/reporting surfaces under `.pan/introspection/` and an intake item under `lib/inbox/in/`.
- Do not run `git push`, `git commit`, `gh pr create`, destructive shell commands, or broad cleanup.

## Time window

1. Let `now` be the current UTC time at command start.
2. Read `.pan/introspection/last-run.json` if it exists.
3. Set the cutoff to the later of:
   - the prior `completed_at` value in `.pan/introspection/last-run.json`; and
   - `now - 7 days`.
4. If the last-run file is missing or unreadable, use `now - 7 days`.
5. Scan only files generated or modified at or after the cutoff. Do not expand beyond the cutoff unless a referenced artifact is needed to understand a finding.

## Evidence to inspect

Inspect recent generated evidence under these local surfaces when they exist:

- `.pan/work/**`
- `.pan/archive/work/**`
- `.pan/sandboxes/**`
- `.pan/scheduler/**`
- `lib/inbox/in/**`
- `lib/inbox/out/**`
- `lib/inbox/threads/**`
- `lib/inbox/notes/**`
- any agent transcript, SDK trace, run log, state file, handoff, next prompt, output manifest, artifact manifest, stage artifact, intervention log, or operator verification file referenced by those paths

Prefer compact manifests, ledgers, state files, and run logs before opening large transcripts. Open large transcripts only when the compact evidence is insufficient to identify the failure mode.

## Report requirements

Write a Markdown report to `.pan/introspection/reports/<UTC-YYYYMMDD-HHMMSS>-introspect.md` with these sections exactly:

1. `# Introspection report`
2. `## Window`
   - `now`
   - `cutoff`
   - `last_run_completed_at`
   - evidence roots scanned
3. `## Executive summary`
4. `## Repo policy/governance misses`
5. `## Artifact generation misses`
6. `## Pipeline gate misses`
7. `## Agent spec misses`
   - Include cases where an agent failed to load, read, cite, or apply documents required by its persona spec or stage contract.
8. `## Operator habits outside supported repo interface`
9. `## Operator friction points with agents`
10. `## Recurring system mistake patterns`
11. `## Proposed changes`
   - Group proposed changes by category: governance updates, new features, code fixes, agent/persona spec updates, pipeline/gate updates, UX/operator tooling, and documentation.
12. `## Evidence index`
   - Cite file paths and concise evidence snippets or summaries. Avoid dumping full transcripts.
13. `## Output manifest`
   - Include consulted docs, produced artifacts, validation performed, and remaining uncertainty.

For every finding, distinguish direct evidence from inference. Do not invent misses when the available evidence is ambiguous; record ambiguity in the report instead.

## Intake item requirements

Create a new Markdown item under `lib/inbox/in/<UTC-day-bucket>/` proposing changes/fixes/updates based on the report. The item must be ready for `intake-analyst` ingestion.

Use the existing timestamped inbox convention:

- day bucket: UTC `YYMMDD`
- filename: `<seconds-to-midnight>_<HHMM>_introspection-followups.md`

The intake item must include YAML frontmatter:

```yaml
title: "Introspection follow-ups"
feature_id: "introspection-followups"
stage: plan
owner: intake-analyst
status: open
created_at: "<now ISO>"
references:
  - "<report path>"
```

The body must include:

- a concise summary of the highest-impact recurring misses
- the proposed changes from the report, grouped by category
- clear acceptance criteria for a future implementation pass
- a reference to the full report path
- `## Output manifest`

Proposed items may be categorically broad. It is acceptable for the intake item to propose governance updates, new features, code fixes, agent/persona spec updates, pipeline/gate changes, or operator tooling improvements.

## Completion marker

After the report and intake item have been written, update `.pan/introspection/last-run.json`:

```json
{
  "command": "introspect",
  "completed_at": "<now ISO>",
  "cutoff": "<cutoff ISO>",
  "report_path": "<report path>",
  "inbox_item_path": "<inbox item path>"
}
```

End with a compact response naming the report path, inbox item path, files scanned count if available, and any important uncertainty.
