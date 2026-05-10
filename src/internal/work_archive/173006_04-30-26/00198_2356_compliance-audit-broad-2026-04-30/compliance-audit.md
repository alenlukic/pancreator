# Compliance Audit — Broad Sweep 2026-04-30

## 1. Scope contract

```yaml
audit_interaction:
  mode: non_interactive   # effective value after defaulting per persona spec §"When you are invoked" #5
```

- **Trigger:** Broad sweep per persona spec §"When you are invoked" #1; no run-log selector; no `audit_interaction.mode` provided.
- **Run-log selector:** none.
- **Invocation timestamp:** 2026-04-30T23:56:42-04:00 (2026-05-01T03:56:42Z UTC).
- **Repo:** `/Users/alen/Dev/tesseract` — branch `main`, HEAD `c9c5def`.
- **Working tree:** clean (no staged or unstaged changes at invocation).
- **Exact path set audited:**
  - `src/personas/*.md` (12 files)
  - `.cursor/agents/*.md` (13 files)
  - `.cursor/rules/*.mdc` (14 files)
  - `src/skills/*/SKILL.md` (8 files)
  - `src/memory/handbook/*.md` (12 files)
  - `src/memory/backlog/index.yaml`
  - `src/memory/adr/*.md` (5 files)
  - `src/internal/tests/compliance/schemas/latest.yaml`, `src/internal/tests/compliance/schemas/v1.yaml`
  - `src/internal/tests/compliance/*.yaml` (4 descriptor files)
  - `src/inbox/in/*.md` (2 files)
  - `src/pipelines/*.yaml` (5 files)
  - `AGENTS.md`, `BOOTSTRAP.md`
  - `src/work/` artifacts (structural check only, not exhaustive content audit)

---

## 2. Checks executed

| id | procedure | reference | outcome |
|---|---|---|---|
| `persona-16-field-completeness` | Verified all 16 Anthropic frontmatter fields are present in each persona file. | persona-spec.md §2 | pass |
| `persona-description-ears-rfc2119` | Checked each `description` field for at least one RFC 2119 obligation keyword (MUST, SHALL, SHOULD, etc.). | persona-spec.md §2; contract-style.md Layer 1 Rule 1.1 | **fail — 2 violations** |
| `persona-color-palette-conformance` | Checked each `color` field against the closed palette defined in persona-spec.md §6 (violet, amber, blue, green, cyan, purple, teal, slate, orange, red). | persona-spec.md §6 | **fail — 1 invalid, 2 reserved/collision** |
| `persona-metadata-required-keys` | Checked required metadata keys (tesseract-risk-tier, tesseract-pipeline-stages, tesseract-bootstrap-only, tesseract-stability, tesseract-checklist) in each persona. | persona-spec.md §3 | pass |
| `persona-metadata-recognized-keys` | Checked metadata map for keys not in the recognized list per persona-spec.md §7. | persona-spec.md §7 | **fail — 1 unknown key** |
| `persona-body-sections-check` | Verified three required body sections ("When you are invoked", "What you MUST produce, every invocation", "What you MUST NOT do") present in each persona. | persona-spec.md §4 | pass |
| `cursor-mdc-parity` | Verified each `.cursor/rules/<name>.mdc` has `description` matching the persona verbatim, `alwaysApply: false`, and `@src/personas/<name>.md` body import. | persona-spec.md §5.2 | pass |
| `cursor-agents-mirror-exists` | Verified each persona has a corresponding `.cursor/agents/<name>.md` mirror. | persona-spec.md §5.1 | pass |
| `skill-file-resolution` | Verified every `skills[]` entry in every persona resolves to an existing `src/skills/<name>/SKILL.md`. | persona-spec.md §2 field 9 | pass |
| `inbox-naming-convention` | Checked all files under `src/inbox/in/` for required `{SID}_{HHMM}_` timestamp prefix per ADR-0005. | src/memory/adr/0005-timestamp-naming-conventions.md | **fail — 1 violation** |
| `backlog-required-fields` | Spot-checked backlog items for required fields (id, title, source, owner, milestone, status, priority, opened_at, links, evidence, notes). | src/memory/handbook/backlog-format.md | pass |
| `compliance-descriptor-shape` | Verified compliance test descriptor files under `src/internal/tests/compliance/` contain required keys (schema_ref, id, severity, trigger_modes, scope, assertion). | src/internal/tests/compliance/schemas/latest.yaml | pass |
| `policy-compliance-artifact-validation` | Checked whether this audit invocation applies structural non-`src/work/` changes requiring a `/src/work/<task-id>/policy-compliance.json` artifact. No non-`src/work/` structural changes were applied; gate requirement does not apply to this invocation. | src/memory/handbook/policy-compliance-contract.md §1–2 | pass (gate not triggered) |
| `content-hash-tbd-audit` | Scanned for `TBD-on-commit` contentHash placeholders in personas, handbook, and ADR files. Multiple found; all pre-existing and tracked by backlog item `bootstrap-content-hash-refresh`. | AGENTS.md §5 dual-anchor policy | note |
| `pipeline-definitions-status` | Verified pipeline YAML files exist under `src/pipelines/`. Runtime wiring is not yet present per AGENTS.md §8; no executable definition violations to raise. | AGENTS.md §8 | note |

---

## 3. Findings

### block

None.

### major

**[MA-001]** `src/personas/contract-writer.md` `description` field does not contain any RFC 2119 obligation keyword. The description reads "Authors machine-checkable contract clauses…" with no SHALL, MUST, or SHOULD. Per persona-spec.md §2, the description MUST be an EARS one-liner using RFC 2119 keywords. Per contract-style.md Layer 1 Rule 1.1, every normative statement MUST carry exactly one RFC 2119 keyword.

- Anchor A: `{kind: lines, path: src/personas/contract-writer.md, range: [4, 4], contentHash: TBD-on-commit}` — `description:` field.
- Anchor B: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [71, 72], contentHash: TBD-on-commit}` — §2 table row 2: "description … EARS one-liner; at most 50 words; shown to other agents at routing time."
- **Note:** `contract-writer` carries `tesseract-self-protection: true` (implied by AGENTS.md §3 meta-persona classification). Fixing the description requires explicit human ratification. No auto-remediation applied.

**[MA-002]** `src/personas/persona-designer.md` `description` field does not contain any RFC 2119 obligation keyword. The description reads "Authors Tesseract subagent persona specifications…" with no SHALL, MUST, or SHOULD.

- Anchor A: `{kind: lines, path: src/personas/persona-designer.md, range: [4, 4], contentHash: TBD-on-commit}` — `description:` field.
- Anchor B: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [71, 72], contentHash: TBD-on-commit}` — §2 table row 2.
- **Note:** `persona-designer` is bootstrap-canonical and self-protected (AGENTS.md §3). Fixing requires explicit human ratification. No auto-remediation applied.

**[MA-003]** `src/personas/supervisor.md` declares `color: magenta`. The value `magenta` does not appear in the closed palette defined in persona-spec.md §6. The permitted values are: violet, amber, blue, green, cyan, purple, teal, slate, orange, red. An out-of-palette color prevents the pipeline-timeline UX renderer from correctly displaying the persona.

- Anchor A: `{kind: lines, path: src/personas/supervisor.md, range: [36, 36], contentHash: TBD-on-commit}` — `color: magenta`.
- Anchor B: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [197, 210], contentHash: TBD-on-commit}` — §6 color palette table.
- **Note:** No auto-remediation applied. Owner routing: `persona-designer`. Suggested fix: change to `color: purple` (listed as "pm and backlog" guideline; nearest semantic match for orchestrator role) pending human approval.

### minor

**[MI-001]** `src/personas/compliance-auditor.md` uses `color: red`. Per persona-spec.md §6, `red` is reserved for "ombudsperson, watchdog" class personas "to preserve operator legibility." `compliance-auditor` is not an ombudsperson.

- Anchor A: `{kind: lines, path: src/personas/compliance-auditor.md, range: [31, 31], contentHash: TBD-on-commit}` — `color: red`.
- Anchor B: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [208, 208], contentHash: TBD-on-commit}` — palette table row: `red | ombudsperson, watchdog | reserved`.
- **Note:** The existing backlog item `bootstrap-colorblind-safe-palette-migration` covers a future palette migration. The `compliance-auditor` color reassignment SHOULD be bundled with that migration. No auto-remediation applied; deferred.

**[MI-002]** `src/personas/coder.md` and `src/personas/tesseract-engineer.md` both declare `color: green`, creating a palette collision. Persona-spec.md §6 states "pick from the unused palette."

- Anchor A: `{kind: lines, path: src/personas/coder.md, range: [29, 29], contentHash: TBD-on-commit}` — `color: green`.
- Anchor B: `{kind: lines, path: src/personas/tesseract-engineer.md, range: [31, 31], contentHash: TBD-on-commit}` — `color: green`.
- Anchor C: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [210, 210], contentHash: TBD-on-commit}` — §6: "When the palette runs out, append a row here; do not improvise."
- **Note:** Suggested fix: reassign `tesseract-engineer` to a currently unused color (e.g., `purple` if `supervisor` migrates away, or a new palette entry). Deferred to `persona-designer` with the `bootstrap-colorblind-safe-palette-migration` batch.

**[MI-003]** `src/personas/tech-lead.md` metadata block contains the key `tesseract-color-suffix: cyan-200`. This key does not appear in the recognized-key list in persona-spec.md §7. Unknown keys raise a Layer 1 warning (escalating to error in M3).

- Anchor A: `{kind: lines, path: src/personas/tech-lead.md, range: [33, 33], contentHash: TBD-on-commit}` — `tesseract-color-suffix: cyan-200`.
- Anchor B: `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [218, 230], contentHash: TBD-on-commit}` — §7 recognized key list.
- **Note:** The key appears to be an improvised UX hint. Suggested remediation: remove the key and document the need in an RFC if a fine-grained color shading system is desired. Deferred to `persona-designer`.

**[MI-004]** `src/inbox/in/timestamp_naming_conventions.md` lacks the required `{SID-prefix}_{HHMM}_` timestamp prefix mandated by ADR-0005. The file is a human-generated spec that was processed by `intake-analyst` (the downstream feature `timestamp-naming-conventions` exists and is complete). Per ADR-0005, the processing agent MUST append the two time prefixes before downstream processing continues.

- Anchor A: `{kind: lines, path: src/inbox/in/timestamp_naming_conventions.md, range: [1, 1], contentHash: TBD-on-commit}` — filename with no SID/HHMM prefix.
- Anchor B: `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [45, 45], contentHash: TBD-on-commit}` — decision: "the agent MUST append the two time prefixes before downstream processing continues."
- **Note:** The spec was processed before ADR-0005 was ratified (or the intake-analyst did not yet apply the rename rule). The rename SHOULD be applied with a corresponding reference-update pass per ADR-0005. Deferred to `intake-analyst` / `tesseract-engineer`.

### note

**[NO-001]** Multiple `contentHash: TBD-on-commit` placeholders exist across personas, handbook files, and ADR files. All placeholders are pre-existing and already tracked by backlog item `bootstrap-content-hash-refresh` (priority: high, milestone: phase-5). No new violations introduced.

- Anchor: `{kind: symbol, path: src/memory/backlog/index.yaml, symbol: bootstrap-content-hash-refresh}`.

**[NO-002]** `src/inbox/in/60714_0708_bootstrap-phase-0a-closure.md` is an active open intake directive (status: open, owner: intake-analyst). Not a compliance violation; signals a pending pipeline work item that has not yet been processed through the delivery pipeline.

- Anchor: `{kind: lines, path: src/inbox/in/60714_0708_bootstrap-phase-0a-closure.md, range: [1, 10], contentHash: TBD-on-commit}`.

**[NO-003]** No non-`src/work/` structural changes were applied during this audit invocation. The policy-compliance artifact gate per `/src/memory/handbook/policy-compliance-contract.md` §1 was therefore not triggered. This is the expected state for a read-and-report broad-sweep invocation.

---

## 4. Auto-remediations applied

None. All findings require human ratification (MA-001, MA-002: self-protected meta-personas) or persona-designer ownership routing (MA-003, MI-001, MI-002, MI-003) or intake-analyst/tesseract-engineer routing (MI-004). No safe local fixes were identified within the non-interactive guardrails for this invocation.

---

## 5. Documentation-impact decision

```yaml
documentation_impact:
  applies: true
  rationale: >
    This audit introduces a new work artifact under src/internal/work_archive/173006_04-30-26/
    00198_2356_compliance-audit-broad-2026-04-30/ that contains findings
    and proposals referencing personas, handbook anchors, ADRs, and backlog
    items. The src/memory/backlog/index.yaml requires one new item for proposal
    PA-002 (deferred; no immediate update per non-interactive deferred-decision
    rule). No existing documentation surfaces were changed; only read.
  changed-surfaces:
    - src/internal/work_archive/173006_04-30-26/00198_2356_compliance-audit-broad-2026-04-30/compliance-audit.md
    - src/internal/work_archive/173006_04-30-26/00198_2356_compliance-audit-broad-2026-04-30/compliance-remediation.md
  deferred-items:
    - id: compliance-audit-broad-2026-04-30-ma001-fix
      rationale: >
        Fixing MA-001 (contract-writer description) requires human ratification
        for a self-protected meta-persona; cannot apply in non-interactive mode.
    - id: compliance-audit-broad-2026-04-30-ma002-fix
      rationale: >
        Fixing MA-002 (persona-designer description) requires human ratification
        for a self-protected meta-persona; cannot apply in non-interactive mode.
    - id: compliance-audit-broad-2026-04-30-ma003-fix
      rationale: >
        Fixing MA-003 (supervisor color: magenta) requires persona-designer
        ownership and human approval of the proposed color assignment.
    - id: compliance-audit-broad-2026-04-30-mi-palette-batch
      rationale: >
        MI-001 and MI-002 (compliance-auditor red reservation, coder/tesseract-engineer
        green collision) are bundled with the existing backlog item
        bootstrap-colorblind-safe-palette-migration for a future batch fix.
```

**Pass/fail:** The documentation-impact decision passes. This invocation produces only read-only analysis artifacts under `src/work/`; no documentation surfaces outside `src/work/` were modified.

---

## 6. Proposal decisions

### PA-001 — Migrate supervisor color to a defined palette value

- **proposal_id:** `pa-001-supervisor-color-migration`
- **status:** `deferred`
- **problem_statement:** `src/personas/supervisor.md` declares `color: magenta`, a value absent from the closed palette in persona-spec.md §6, preventing conformant UX rendering.
- **evidence_anchors:**
  - `{kind: lines, path: src/personas/supervisor.md, range: [36, 36], contentHash: TBD-on-commit}`
  - `{kind: lines, path: src/memory/handbook/persona-spec.md, range: [197, 210], contentHash: TBD-on-commit}`
- **proposed_change:** Change `src/personas/supervisor.md` `color` field to `purple` (nearest semantic match for an orchestrator role), update the `.cursor/agents/supervisor.md` mirror, and add a palette-table row or note reserving the choice. Bundle with the `bootstrap-colorblind-safe-palette-migration` backlog batch.
- **expected_impact:** Closes MA-003; eliminates Layer 1 parse failure for the `color` field in Phase 3 tooling.
- **risk_note:** `purple` is listed as "pm and backlog" guideline; applying it to an orchestrator may confuse future palette readers. An explicit palette-table row noting supervisor's color choice mitigates this.
- **owner_recommendation:** `persona-designer`

### PA-002 — Add EARS/RFC2119 `description` validation to persona creation checklist

- **proposal_id:** `pa-002-description-ears-enforcement`
- **status:** `deferred`
- **problem_statement:** Two self-protected meta-personas (`contract-writer`, `persona-designer`) have `description` fields that lack RFC 2119 obligation keywords, violating Layer 1 Rule 1.1, and the violation was not caught at authoring time.
- **evidence_anchors:**
  - `{kind: lines, path: src/personas/contract-writer.md, range: [4, 4], contentHash: TBD-on-commit}`
  - `{kind: lines, path: src/personas/persona-designer.md, range: [4, 4], contentHash: TBD-on-commit}`
  - `{kind: lines, path: src/memory/handbook/contract-style.md, range: [62, 65], contentHash: TBD-on-commit}`
- **proposed_change:** Add `description-rfc2119-keyword-present` to `tesseract-checklist` in the persona-spec.md §3 required checklist, add a Layer 1 lint rule in the `author-persona` skill that rejects a `description` with no RFC 2119 keyword, and fix both meta-persona descriptions through the human-ratification channel.
- **expected_impact:** Prevents future EARS description violations at authoring time; closes MA-001 and MA-002 after human ratification of the prose fixes.
- **risk_note:** Adds one lint gate to persona authoring. The cost is low; the benefit is uniform EARS conformance across all personas.
- **owner_recommendation:** `persona-designer` (spec update) + `coder` (lint rule automation, Phase 3)

**Non-interactive deferred decision record:** Both proposals are set to `deferred`. Owner routing and rerun conditions are recorded in §8 (Deferred decisions) below.

---

## 7. Gate recommendation

```yaml
compliance_passes: false
predicate: >
  Three major findings (MA-001, MA-002, MA-003) remain unresolved:
  two self-protected meta-personas carry non-EARS descriptions and one
  persona declares a color outside the closed palette. All three require
  human ratification or persona-designer-owned fixes before governed
  structural commits proceed.
```

---

## 8. Deferred decisions

| id | finding/proposal | next owner | rerun trigger |
|---|---|---|---|
| `ma001-description-fix` | MA-001: contract-writer description lacks RFC2119 keyword | Human (for ratification) → persona-designer (for edit) | After human ratifies prose rewrite for `src/personas/contract-writer.md` description field. |
| `ma002-description-fix` | MA-002: persona-designer description lacks RFC2119 keyword | Human (for ratification) → persona-designer (for edit) | After human ratifies prose rewrite for `src/personas/persona-designer.md` description field. |
| `ma003-supervisor-color` | MA-003: supervisor uses out-of-palette color `magenta` | persona-designer | After persona-designer proposes a conforming color assignment and human approves. |
| `mi001-compliance-auditor-red` | MI-001: compliance-auditor uses reserved red | persona-designer (batch with `bootstrap-colorblind-safe-palette-migration`) | When `bootstrap-colorblind-safe-palette-migration` backlog item is actioned. |
| `mi002-green-collision` | MI-002: coder and tesseract-engineer share `color: green` | persona-designer (batch with palette migration) | When `bootstrap-colorblind-safe-palette-migration` backlog item is actioned. |
| `mi003-unrecognized-key` | MI-003: tech-lead has unrecognized `tesseract-color-suffix` metadata key | persona-designer | On next persona maintenance pass; remove key or open RFC. |
| `mi004-inbox-rename` | MI-004: `src/inbox/in/timestamp_naming_conventions.md` missing SID/HHMM prefix | intake-analyst / tesseract-engineer | On next intake-analyst invocation or maintenance pass per ADR-0005. |
| `pa001-supervisor-color-migration` | PA-001: supervisor color migration proposal | persona-designer | Human approves proposal PA-001; persona-designer implements; rerun broad audit. |
| `pa002-description-ears-enforcement` | PA-002: EARS validation in author-persona skill | persona-designer + coder (Phase 3) | Human approves proposal PA-002; persona-designer updates spec; rerun broad audit post-Phase-3. |
