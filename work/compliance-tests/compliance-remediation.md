# Compliance Remediation Summary — compliance-tests (post-review gate)

## Files changed

| file | change |
|---|---|
| `work/compliance-tests/compliance-audit.md` | Replaced previous pre-approval audit with post-`review_passes: true` full audit |
| `work/compliance-tests/compliance-remediation.md` | This file; updated to reflect current remediation outcomes |
| `work/compliance-tests/test-report.md` | Lines 27–29: replaced stale `memory/features/...contracts/tests/*.yaml` citations with canonical `tests/compliance/*.yaml` citations |
| `work/compliance-tests/policy-compliance.json` | `changed_surfaces`: removed 5 deleted `memory/features/...contracts/...` paths; added 5 canonical `tests/compliance/` paths |

---

## Unresolved findings checklist

- [ ] **Block findings:** none.
- [ ] **Major findings:** none.
- [x] **MINOR-01** resolved — `test-report.md` stale descriptor citations corrected.
- [x] **MINOR-02** resolved — `policy-compliance.json` `changed_surfaces` updated to
  canonical paths.
- [ ] **NOTE-01 (deferred)** — AGENTS.md §6.1 uses prose equivalents of `structure-change`
  and `scheduled-cadence` literals; non-blocking, route to `tech-lead` on next §6.1 edit.
- [ ] **NOTE-02 (deferred)** — `review.md` TBD-on-commit hashes; route to `librarian`
  on `bootstrap-content-hash-refresh` pass.
- [ ] **NOTE-03 (deferred)** — `plan.md`, `adr-draft.md`, `spec.md` TBD-on-commit hashes;
  route to `librarian` on `bootstrap-content-hash-refresh` pass.

---

## Next-owner routing

| owner | action |
|---|---|
| `LocalUserAuthorizer` (human) | Review focused audit artifacts; ratify `compliance_passes: true` gate outcome before slice ship. |
| `librarian` | Refresh `TBD-on-commit` hashes in `review.md`, `plan.md`, `adr-draft.md`, `spec.md` during next citation-maintenance pass (`bootstrap-content-hash-refresh`). |
| `tech-lead` | On next AGENTS.md §6.1 structural update, add backtick-quoted `structure-change` and `scheduled-cadence` literals alongside existing prose for exact-match scanner compatibility. |
