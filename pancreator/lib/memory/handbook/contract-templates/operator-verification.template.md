---
template: operator-verification
slug: operator-verification
stability: experimental
phase: 1
allowed-in-milestones:
  - M1+
purpose: |
  Scaffold for operator-facing acceptance criteria and manual test flows authored
  at feature-delivery complete or ad-hoc close. The human operator executes these
  checks after archival to confirm correctness; failures SHOULD drive pan reopen.
references:
  - '{"kind":"lines","path":"lib/personas/librarian.md","range":[114,133],"contentHash":"3f338c1","note":"Librarian complete-stage duty to finalize operator-verification.md before close-artifacts."}'
...

# Operator section
- 👀 **In this file:** Template — Operator verification
- ⚖️ **Why it matters:** Quick orientation for Template — Operator verification before agents load the full contract.
- 🧭 **See also:**
  - pancreator/lib/memory/handbook/agent-document-registry.md

# Template — Operator verification

Use this template when authoring `.pan/work/<day>/<task-id>/operator-verification.md`
(or the same path under `.pan/archive/work/` after closure). Replace placeholders with
run-specific content synthesized from the feature spec, delivery report,
test-report manual verification section, and touch-set.

## Acceptance criteria

Observable pass/fail checks the operator SHALL ratify after close:

- [ ] AC1: Replace with one observable behavior (for example, CLI command exits 0).
- [ ] AC2: Replace with one user-visible outcome or read-only inspection.

Each criterion MUST name what to observe and what constitutes pass versus fail.

## Manual test flows

### Flow 1 — Replace with a short title

**Preconditions:** List setup (branch, env, server URL, or read-only paths).

**Steps:**

1. Step one with a copy-paste command or UI path.
2. Step two with expected intermediate state.

**Expected result:** One sentence describing pass behavior.

### Flow 2 — Optional additional flow

**Preconditions:** …

**Steps:**

1. …

**Expected result:** …

## Sign-off

The operator MAY record results in optional `operator-verification.json` or reopen
the task when any criterion or flow fails:

```bash
pnpm -w exec pan reopen <task-id> --reason "Operator verification failed: describe flow and criterion"
```
