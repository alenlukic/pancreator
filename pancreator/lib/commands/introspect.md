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
- The analysis MUST assess whether agents followed context/token-economy guidance when gathering evidence, including RTK-first shell retrieval expectations from `lib/memory/handbook/context-economy.md`.
- Transcript and rationale review is mandatory. This command MUST inspect in-window agent transcripts and any exposed reasoning/rationale traces needed to judge what agents did, why they did it, and how they did it. Manifest attestation alone is insufficient for agent-spec compliance findings.
- Do not modify indexed source files. This command may write only local runtime/reporting surfaces under `.pan/introspection/` and an intake item under `lib/inbox/in/`.
- Do not run `git push`, `git commit`, `gh pr create`, destructive shell commands, or broad cleanup.

## Time window

1. Let `now` be the current UTC time at command start.
2. Read `.pan/introspection/last-run.json` if it exists.
3. Set the cutoff to the later of:
   - the prior `completed_at` value in `.pan/introspection/last-run.json`; and
   - `now - 7 days`.
4. If the last-run file is missing or unreadable, use `now - 7 days`.
5. Scan only files generated or modified at or after the cutoff. This is the smaller window of "since the last completed introspect" and "the trailing 7 days." Do not expand beyond the cutoff unless a referenced artifact is needed to understand a finding.

## Evidence to inspect

Inspect recent generated evidence under these local surfaces when they exist:

- `.pan/work/**`
- `.pan/archive/work/**`
- `.pan/sandboxes/**`
- `.pan/scheduler/**`
- `lib/inbox/in/**`
- `lib/inbox/out/**`
- `lib/inbox/threads/**`
- all agent transcripts, transcript bundles, and SDK traces for in-window runs, including transcript-store files outside the repo when the workspace exposes them
- any run log, state file, handoff, next prompt, output manifest, artifact manifest, stage artifact, intervention log, or operator verification file referenced by those paths or transcripts
- any shell/tool invocation traces exposed by transcripts, terminal captures, SDK logs, or rationale metadata that are needed to determine whether shell-based repo inspection used `rtk` first or escalated to raw commands with justification

Do **not** inspect `lib/inbox/notes/**`; it is operator-only per inbox lifecycle and is not a valid evidence source for this command.

Use compact manifests, ledgers, state files, and run logs first to enumerate the in-scope runs, personas, artifacts, and transcript paths. They are a map, not a substitute. For every in-scope run, transcript review is mandatory: read the corresponding agent transcripts and any exposed reasoning/rationale traces before concluding on agent-spec compliance. Do not rely solely on `consulted_docs`, output manifests, or gate outcomes when assessing whether an agent actually loaded, understood, and applied the documents named by its persona spec or stage contract.

## Report requirements

Write a Markdown report to `.pan/introspection/reports/<UTC-YYYYMMDD-HHMMSS>-introspect.md` with these sections exactly:

1. `# Introspection report`
2. `## Window`
   - `now`
   - `cutoff`
   - `last_run_completed_at`
   - evidence roots scanned
   - transcript coverage summary (which in-window runs/personas had transcript evidence, and any gaps)
3. `## Executive summary`
4. `## Repo policy/governance misses`
5. `## Artifact generation misses`
6. `## Pipeline gate misses`
7. `## Agent spec misses`
   - Include cases where an agent failed to load, read, cite, or apply documents required by its persona spec or stage contract.
   - Include cases where transcript/tool evidence suggests the agent ignored context-economy guidance, especially RTK-first shell retrieval expectations, without a documented need for raw output.
   - This section MUST be informed by transcript + rationale review, not only by manifest attestation.
   - Distinguish "artifact claims compliance" from "transcript evidence suggests compliance" when those differ.
   - When assessing RTK usage, distinguish shell-based inspection flows from built-in file/search tools; flag a miss only when `context-economy.md` would have required an `rtk` first pass or an explicit escalation rationale.
8. `## Operator habits outside supported repo interface`
9. `## Operator friction points with agents`
10. `## Recurring system mistake patterns`
   - Call out repeated over-reading, broad context loading, or raw shell inspection habits that violate token/context-economy guidance even when they did not cause a gate failure.
11. `## Proposed changes`
   - Group proposed changes by category: governance updates, new features, code fixes, agent/persona spec updates, pipeline/gate updates, UX/operator tooling, and documentation.
12. `## Evidence index`
   - Cite file paths and concise evidence snippets or summaries. Avoid dumping full transcripts.
   - Include the transcript paths actually reviewed for each run/persona named in findings.
13. `## Output manifest`
   - Include consulted docs, produced artifacts, validation performed, and remaining uncertainty.

For every finding, distinguish direct evidence from inference. Do not invent misses when the available evidence is ambiguous; record ambiguity in the report instead. When transcript coverage is partial or missing for an in-window run, say so explicitly and explain whether the result is a coverage gap, a platform gap, or a scope decision forced by missing evidence.

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
