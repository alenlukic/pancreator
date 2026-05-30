---
name: adopt-existing-repo
description: Runs one non-destructive scan of an existing repository at first install. Detects languages, frameworks, test infrastructure, continuous-integration configuration, dependency manifests, conventions, and existing agent contracts; proposes initial SMEs and a threshold policy seeded from the repository's measured baselines; emits one `/lib/memory/adoption/scan-<date>.md` plus paired inbox items for human ratification.
license: Apache-2.0
metadata:
  pancreator-stability: experimental
  pancreator-bootstrap-only: false
  pancreator-pipeline-stages: [adopt]
  pancreator-risk-tier: medium
  pancreator-required-handbook:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/contract-style.md
  pancreator-emits:
    - /lib/memory/adoption/scan-<date>.md
    - lib/inbox/in/<timestamp>-adopter-sme-<name>.md
    - lib/inbox/in/<timestamp>-adopter-thresholds.md
references:
  - kind: lines
    path: docs/PRD.md
    range: [504, 504]
    contentHash: 2ce8e5c
    note: "PRD §6 — MVP roster: adopter runs at first install on existing repos via the `adopt` sub-pipeline; read-only on existing files; write-only to Pancreator-prefixed paths."
  - kind: lines
    path: docs/PRD.md
    range: [207, 223]
    contentHash: 2ce8e5c
    note: "PRD §3.5 US-9 — Greenfield AND existing projects: non-destructive scan, no-conflict guarantees, additive merge of existing AGENTS.md and .cursor/rules, and seeded threshold policy."
  - kind: lines
    path: docs/PRD.md
    range: [701, 701]
    contentHash: 2ce8e5c
    note: "PRD §7 — `adopt` pipeline definition: drives the adopter through codebase scan, conflict-checks every write, surfaces a per-file diff before applying, writes `scan-<date>.md`, and posts inbox proposals."
  - kind: lines
    path: docs/PRD.md
    range: [946, 947]
    contentHash: 2ce8e5c
    note: "PRD §8 — Memory architecture: `/lib/memory/adoption/scan-<date>.md` is a citation-bearing artifact, replayable on `pan re-adopt`."
---

# Skill — `adopt-existing-repo`

A reusable 7-step procedure that converts one existing repository into one
scan report plus a small set of human-ratifiable proposals. The canonical
caller is `lib/personas/adopter.md`. The skill MUST stay non-destructive: every
write lands under a Pancreator-prefixed path declared at PRD §3.5 lines 215
through 222, and the dry-run pass MUST exit non-zero rather than touch any
existing file the human has not ratified.

## Prerequisites

- The repository SHALL have a `.git/` directory at the working-tree root;
  the skill MUST halt if the path is not a git repository.
- `/lib/memory/adoption/` SHALL exist as a writable directory; the skill
  scaffolds it on first invocation.
- `/lib/memory/handbook/glossary.md` and `/lib/memory/handbook/contract-style.md`
  SHALL exist; the scan report body satisfies Layer 1 lint per PRD §4.6.
- The skill SHALL NOT require any pre-existing `AGENTS.md`,
  `.cursor/rules/`, or `.github/agents/`; existence of these files routes through the additive merge plan in Step 6.

## The 7-step adoption loop

Execute these steps in order, once per `pancreator init` invocation.

### Step 1 — Run the conflict dry-run

Walk every Pancreator-prefixed write target the scan would emit and verify
no existing file occupies the path. The Pancreator-prefixed write surface
declared at PRD §3.5 lines 215 through 222 is `/lib/memory/`, `/lib/personas/`,
`/lib/personas/skills/`, `/lib/pipelines/`, `/lib/inbox/`, `/.pan/`, and `pancreator.yaml`.
The proposed `pancreator.yaml` block MUST include `project_root`; use `.` when
the harness is embedded at the repository root being adopted.

When any target path conflicts with an existing file, the skill MUST exit
non-zero and post one inbox item at
`lib/inbox/in/<timestamp>-adopter-conflicts.md` carrying the per-file diff per
PRD §3.5 line 222. The human MUST confirm each file before the scan
resumes.

### Step 2 — Detect languages, frameworks, and runtime versions

Detect the repository's primary language(s) by file extension and lockfile
(`package.json`, `pnpm-lock.yaml`, `pyproject.toml`, `Cargo.toml`,
`go.mod`, `pom.xml`, `Gemfile`, etc.). For each language detected, record:

- The language name and the runtime version pinned by the lockfile.
- The framework families detected (e.g., React, Next.js, Django, FastAPI,
  Spring, Rails, Rust web framework).
- The package manager(s) detected.

Each detected fact MUST cite the source manifest path via dual-anchor
citation per PRD §8. A fact without a citation fails the gate.

### Step 3 — Detect test infrastructure and continuous-integration

Detect every test runner declared in package manifests, `pyproject.toml`,
`Cargo.toml`, or analogous files. For each runner, record the framework
version and the coverage tool (when one is configured).

Detect the continuous-integration provider by walking
`.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `.azuredevops/`, and
`buildkite/`. For each workflow file, record the provider, the gating
commands invoked, and the matrix axes.

When the human's existing CI invokes test commands the skill detects, the
proposed `pancreator.yaml: commands` block MUST shell out to those commands
rather than replace them per PRD §3.5 line 223.

### Step 4 — Inventory dependency manifests

For each manifest detected, record the production-dependency count and the
development-dependency count. Highlight every dependency the threshold
policy MUST gate on:

- Production deps with known CVEs at scan time (when an SCA tool is
  available; otherwise route an inbox item proposing one).
- Top-N deps by transitive size when a bundler manifest is detected.
- Deps that strongly correlate with an SME spawn proposal in Step 6
  (e.g., Stripe SDK → propose `sme-stripe`; Postgres driver → propose
  `sme-postgres`).

### Step 5 — Inventory conventions

Detect every lint, format, and code-style anchor file:
`.eslintrc*`, `.prettierrc*`, `pyproject.toml [tool.ruff]`,
`rustfmt.toml`, `.editorconfig`, `tsconfig.json`'s `compilerOptions`. For
each file, record the path and a one-sentence summary of the
opinionation it asserts.

### Step 6 — Plan the additive merge for existing agent contracts

Detect every existing agent-contract file the human has authored:
`AGENTS.md`, `.cursor/rules/*.mdc`, `.github/agents/*`. For each file, the
plan MUST classify the file as exactly one of:

- **`keep`.** The file already aligns with Pancreator's contract; the scan
  records the alignment and proposes no change.
- **`augment`.** The file aligns in scope but the scan proposes additive
  edits the human MUST ratify (e.g., adding a Pancreator delegation
  paragraph to an existing `AGENTS.md`).
- **`conflict`.** The file disagrees with Pancreator's expectations and the
  scan MUST surface the conflict to the inbox; the skill MUST NOT
  overwrite a `conflict` file under any flag short of explicit per-file
  human confirmation.

A file the plan leaves unclassified fails the gate.

### Step 7 — Author the scan report and the inbox proposals

Overwrite `/lib/memory/adoption/scan-<date>.md` with the eight `##` sections
declared in `lib/personas/adopter.md` in this order. Every fact in every
section MUST carry a dual-anchor citation per PRD §8.

1. Repository facts.
2. Test infrastructure.
3. Continuous-integration configuration.
4. Dependency manifests.
5. Conventions.
6. Existing agent contracts.
7. Proposed SMEs.
8. Proposed threshold policy.

The proposed-threshold-policy block MUST be a YAML block keyed against
`pancreator.yaml`. It MUST include top-level `project_root` as either an
absolute path, a path relative to the directory containing `pancreator.yaml`, or
`.` when the harness is embedded at the adopted repository root. Its numeric
thresholds are seeded from the repository's current measured baselines per PRD
§3.5 US-9 line 220 (e.g., the current statement-coverage figure becomes the
floor, not an aspirational number).

Post one Markdown file per proposed SME at
`lib/inbox/in/<timestamp>-adopter-sme-<name>.md` and one threshold-policy
proposal at `lib/inbox/in/<timestamp>-adopter-thresholds.md`. Each inbox file
MUST link the relevant section of the scan report.

Apply the Layer 1 lint discipline declared in
`/lib/memory/handbook/contract-style.md` to the scan report. Each rule MUST
hold:

- One RFC 2119 obligation keyword per normative clause.
- One EARS template per normative clause.
- Active voice and present tense.
- Numeric claims quantified with units.
- No weasel words from the PRD §4.6 ban list.
- Every domain noun resolves to `/lib/memory/handbook/glossary.md`.
- Median sentence length at most 30 words.
- p95 sentence length at most 40 words.

When all gates are green, the skill stages the scan report and the inbox
proposals. The skill MUST NOT commit; the skill MUST NOT push. The
supervisor or the human applies the threshold-policy proposal to
`pancreator.yaml` after ratification.

## Stop conditions

- Halt when the working tree is not a git repository; route an inbox item
  rather than scaffold.
- Halt when the dry-run pass would touch any file outside the
  Pancreator-prefixed write surface; exit non-zero and post a per-file
  diff per PRD §3.5 line 222.
- Halt when `/lib/memory/adoption/scan-*.md` already exists; treat the run as
  a re-scan and emit a delta against the most recent scan rather than
  silently overwrite.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.
- Halt when any dual-anchor citation reports `gone` per the content-hash
  verifier; refresh the anchor or open an inbox item.

## Failure-handling

- If the human runs `npx pancreator init` against a repository that already
  carries `/lib/memory/adoption/scan-*.md`, the skill MUST treat the run as a
  re-scan and emit a delta report at `/lib/memory/adoption/scan-<date>.md`
  for the new date per `lib/personas/adopter.md`.
- If the proposed SME list exceeds 7 entries, the skill MUST split the
  list across at most 7 inbox items and route an additional summary item
  to avoid drowning the human's inbox.

## Cost guards

- Per-scan token budget defaults to 80 000 tokens across all 8 sections.
  A budget exhaustion mid-scan MUST trip the breaker and route an inbox
  item; the skill MUST NOT silently truncate sections.
- The proposed threshold policy MUST include `project_root` and MUST seed
  every numeric gate with the current measured baseline per PRD §3.5 line 220;
  a baseline the skill cannot measure MUST appear as
  `value: TBD-measure-on-first-run` rather than as an invented number.
