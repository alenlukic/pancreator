---
kind: ratification-request
feature_id: json-formatting
intake_round: 1
spec_path: lib/memory/features/json-formatting/spec.md
closed_question_count: 7
open_question_count: 0
status: human-ratified
created: 2026-05-23T03:22:00Z
---

# Intake ratification request — `json-formatting`

The intake-analyst has completed the `canonicalize-spec` clarifying dialogue
for feature `json-formatting` in **1 round**. All 7 clarifying questions are
resolved. The `## Open questions` section in the canonical spec is empty; the
spec is ready for the `human_approval` gate.

## Spec location

`lib/memory/features/json-formatting/spec.md`

## Closed questions (7 of 7)

| # | Topic | Resolution |
|---|-------|------------|
| Q1 | Hash abbreviation length | Length matches `git rev-parse --short HEAD` output at write time (currently 7 characters in this repo). |
| Q2 | `contentHash` citation field scope | Abbreviation applies to SHA-256 content hashes in dual-anchor citations as well as git commit hashes. **See policy tension below.** |
| Q3 | Scope of "output files" | Every `.json` file produced or maintained by repo functionality or the human operator; files from external libraries are excluded. |
| Q4 | Vendored/third-party exclusions | `node_modules/`, third-party vendored paths, `package-lock.json`, `tsconfig.tsbuildinfo`, and similar tooling-regenerated files are excluded. |
| Q5 | Array element formatting | Pretty-printer default; strict one-element-per-line is not required. |
| Q6 | Migration ownership | One-shot bulk script run by `pancreator-engineer`. |
| Q7 | Enforcement mechanism | New compliance test under `tests/compliance/`. |

## Policy tension flagged for ratification (Q2)

The operator confirmed abbreviation applies to SHA-256 `contentHash` fields in
dual-anchor citations. The glossary (`lib/memory/handbook/glossary.md` lines
204–206) defines `contentHash` as the full 64-character SHA-256 digest used by
the citation verifier. Storing an abbreviated SHA-256 would break
`valid | moved | changed | gone` comparison semantics without a companion
contract update.

The spec records this decision and defers the verifier update to a companion
feature. The plan stage for `json-formatting` MUST resolve whether:

- (a) the abbreviated form is stored and the verifier is updated to support
  prefix comparison, or
- (b) abbreviation applies only to rendered output while the stored value
  retains the full 64-character digest.

**Answer**: This has been addressed. `glossary.md` has been updated. ONLY abbreviated hashes are to be used moving forward. This feature is closed. This inbox item is out of date.

**Human ratification is required on this point before the plan stage proceeds.**

## Intake closed — next action

Please ratify the spec at `lib/memory/features/json-formatting/spec.md` and
advance the `intake` stage. After ratification the `tech-lead` persona owns
the `plan` stage.
