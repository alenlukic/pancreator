# Compliance Audit — compliance-tests (post-review gate)

## 1. Scope contract

```yaml
audit_interaction:
  mode: non_interactive   # effective value after default
```

- **Trigger:** focused compliance gate pass after `review_passes: true`; `operator-on-demand`
  invocation per AGENTS.md §6.1.
- **Run-log selector:** none provided; broad focused sweep over declared touch-set and
  supporting artifacts.
- **Exact path set audited:**
  - Touch-set paths from `archive/work/173009_04-27-26/68576_0457_compliance-tests/touch-set.json`:
    - `lib/internal/tests/compliance/schemas/latest.yaml`
    - `lib/internal/tests/compliance/schemas/v1.yaml`
    - `lib/internal/tests/compliance/high-remediation-blocking.yaml`
    - `lib/internal/tests/compliance/medium-backlog-default-off.yaml`
    - `lib/internal/tests/compliance/low-warning-emission.yaml`
    - `lib/memory/features/compliance-tests/manual-runbook.md`
    - `lib/memory/features/compliance-tests/severity-routing.md`
    - `lib/memory/features/compliance-tests/run-template.json`
    - `AGENTS.md`
    - `lib/memory/backlog/index.yaml`
  - Supporting compliance artifacts:
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md`
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md`
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/compliance-audit.md`
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/compliance-remediation.md`
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json`
    - `archive/work/173009_04-27-26/68576_0457_compliance-tests/touch-set.json`

---

## 2. Checks executed

| id | procedure | outcome |
|---|---|---|
| `scope-inventory` | Verified all declared touch-set paths exist on disk. | pass |
| `staged-deletion-check` | Verified 5 duplicate `lib/memory/features/compliance-tests/contracts/` files are absent from working tree. | pass |
| `review-gate-check` | Verified `archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md` records `review_passes: true`. | pass |
| `descriptor-shape-check` | Verified required keys (`schema_ref`, `id`, `severity`, `trigger_modes`, `scope`, `assertion`) and `schema_ref` value for three files under `lib/internal/tests/compliance/`. | pass |
| `schema-presence-check` | Verified `lib/internal/tests/compliance/schemas/latest.yaml` and `v1.yaml` exist and contain required JSON Schema fields. | pass |
| `agents-trigger-check` | Verified AGENTS.md §6.1 covers all three invocation modes: `operator-on-demand` (literal), structure-change (prose), and scheduled cadence (prose-deferred). | pass |
| `backlog-item-check` | Verified `compliance-tests-automation-wiring` exists with `status: deferred` in `lib/memory/backlog/index.yaml`. | pass |
| `policy-compliance-gate-readiness` | Verified `archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json` exists, governing sources enumerate AGENTS.md/PRD.md, and `changed_surfaces` post-remediation lists only active (non-deleted) paths. | pass (post-fix) |
| `test-report-citation-check` | Verified `archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md` cites canonical `lib/internal/tests/compliance/` descriptor paths, not deleted `lib/memory/features/...` paths. | pass (post-fix) |
| `layer-1-prose-check` | Verified body prose in emitted artifacts uses RFC 2119 keywords, EARS-style clauses, active voice, present tense, and glossary-resolved nouns. | pass |
| `tbd-hash-check` | Catalogued `TBD-on-commit` contentHash placeholders across touched files; confirmed all are tracked by existing backlog item `bootstrap-content-hash-refresh`. | note |

---

## 3. Findings

### block

- None.

### major

- None.

### minor

- **[MINOR-01]** `archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md` lines 27–29 cited
  `lib/memory/features/compliance-tests/contracts/tests/*.yaml` paths that no longer exist
  after staged deletion. Auto-remediated in this pass.
  Anchor A: `{kind: lines, path: archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md, range: [27, 29],
  contentHash: TBD-on-commit}`.
  Anchor B: `{kind: lines, path: lib/internal/tests/compliance/high-remediation-blocking.yaml,
  range: [1, 14], contentHash: TBD-on-commit}`.

- **[MINOR-02]** `archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json` `changed_surfaces`
  (prior lines 17–21) listed 5 paths staged for deletion. These paths are no longer
  active working-tree artifacts. Auto-remediated: replaced with canonical
  `lib/internal/tests/compliance/` paths. Anchor A: `{kind: lines,
  path: archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json, range: [11, 30],
  contentHash: TBD-on-commit}`. Anchor B: `{kind: lines,
  path: archive/work/173009_04-27-26/68576_0457_compliance-tests/touch-set.json, range: [3, 14],
  contentHash: TBD-on-commit}`.

### note

- **[NOTE-01]** AGENTS.md §6.1 uses prose equivalents of the `structure-change` and
  `scheduled-cadence` enum identifiers rather than backtick-quoted literals. All three
  invocation modes are semantically covered. `review_passes: true` confirms this
  satisfies the reviewer's acceptance check. No code change required.
  Anchor A: `{kind: lines, path: AGENTS.md, range: [130, 141], contentHash:
  TBD-on-commit}`. Anchor B: `{kind: lines,
  path: lib/memory/features/compliance-tests/spec.md, range: [70, 75],
  contentHash: TBD-on-commit}`.

- **[NOTE-02]** `archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md` carries `TBD-on-commit`
  contentHash placeholders in evidence anchors and remains unstaged in the working
  tree. The `review_passes: true` verdict is established and non-blocking. Tracked
  by `bootstrap-content-hash-refresh` in `lib/memory/backlog/index.yaml`.
  Anchor A: `{kind: lines, path: archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md, range: [1, 10],
  contentHash: TBD-on-commit}`. Anchor B: `{kind: lines,
  path: lib/memory/backlog/index.yaml, range: [23, 35], contentHash: TBD-on-commit}`.

- **[NOTE-03]** `plan.md`, `adr-draft.md`, and `spec.md` carry multiple
  `TBD-on-commit` contentHash values in `references[]` arrays. All are tracked
  by backlog item `bootstrap-content-hash-refresh`. No gate impact in this slice.
  Anchor A: `{kind: lines, path: archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md, range: [11, 56],
  contentHash: TBD-on-commit}`. Anchor B: `{kind: lines,
  path: lib/memory/backlog/index.yaml, range: [23, 35], contentHash: TBD-on-commit}`.

---

## 4. Auto-remediations applied

- **Fix MINOR-01** — `archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md` lines 27–29: replaced
  three stale `lib/memory/features/compliance-tests/contracts/tests/*.yaml` PASS lines
  with canonical `lib/internal/tests/compliance/*.yaml` PASS lines. Risk: none; the replacement
  paths are canonical and all three files pass schema validation. Changed paths:
  `archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md`.

- **Fix MINOR-02** — `archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json`
  `changed_surfaces`: removed 5 deleted `lib/memory/features/...contracts/...` entries;
  added `lib/internal/tests/compliance/schemas/latest.yaml`, `lib/internal/tests/compliance/schemas/v1.yaml`,
  `lib/internal/tests/compliance/high-remediation-blocking.yaml`,
  `lib/internal/tests/compliance/medium-backlog-default-off.yaml`, and
  `lib/internal/tests/compliance/low-warning-emission.yaml` in their place. Risk: none; these are
  the canonical paths already listed in `touch-set.json`. Changed paths:
  `archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json`.

---

## 5. Documentation-impact decision

Documentation-impact evaluation: **pass**.

```yaml
documentation_impact:
  applies: true
  rationale: >
    This compliance pass updated two supporting artifacts under archive/work/173009_04-27-26/68576_0457_compliance-tests
    to remove stale path citations, refreshed the audit artifacts, and emitted
    compliance-remediation.md.
  changed_surfaces:
    - archive/work/173009_04-27-26/68576_0457_compliance-tests/compliance-audit.md
    - archive/work/173009_04-27-26/68576_0457_compliance-tests/compliance-remediation.md
    - archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md
    - archive/work/173009_04-27-26/68576_0457_compliance-tests/policy-compliance.json
  deferred_items: []
```

---

## 6. Proposal decisions

No policy or structure proposals are emitted in this pass. All observed gaps
(TBD-on-commit hashes, automation wiring) are already tracked through existing
backlog items. No repeatable control gap is untracked.

---

## 7. Gate recommendation

**`compliance_passes: true`**

The declared focused scope is complete. All touch-set artifacts are present. The
three canonical compliance descriptors pass schema-shape validation and `schema_ref`
alignment. Duplicate paths under `lib/memory/features/compliance-tests/contracts/` are
absent from the working tree. AGENTS.md §6.1 covers all three invocation modes.
`lib/memory/backlog/index.yaml` carries the required deferred automation item. The two
minor stale-citation findings were auto-remediated. No block or major findings
remain. Policy-compliance and documentation-impact obligations are satisfied.

---

## 8. Deferred decisions

| id | deferred item | next owner | rerun trigger |
|---|---|---|---|
| NOTE-01 | AGENTS.md enum-literal alignment for trigger-mode identifiers | tech-lead | next AGENTS.md structural edit requiring §6.1 update |
| NOTE-02 | Refresh `TBD-on-commit` hashes in `review.md` | librarian | `bootstrap-content-hash-refresh` execution pass |
| NOTE-03 | Refresh `TBD-on-commit` hashes in `plan.md`, `adr-draft.md`, `spec.md` | librarian | `bootstrap-content-hash-refresh` execution pass |
