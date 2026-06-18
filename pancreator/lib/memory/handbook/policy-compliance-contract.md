---
slug: policy-compliance-contract
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [compliance-auditor, supervisor, tech-writer]
purpose: |
  Compatibility anchor for older prompts and cached references that still name
  `policy-compliance-contract.md`. The canonical policy/compliance obligations
  now live in narrower handbook pages; agents SHALL route through this page only
  as a redirect and SHALL load the applicable canonical source before acting.
related:
  - /lib/memory/handbook/compliance-runs.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/documentation-impact-contract.md
  - /lib/memory/handbook/operator-output-contract.md
  - /AGENTS.md
...

# Operator section
- 👀 **In this file:** Policy Compliance Contract (Legacy Redirect)
- ⚖️ **Why it matters:** Quick orientation for Policy Compliance Contract (Legacy Redirect) before agents load the full contract.
- 🧭 **See also:**
  - /lib/memory/handbook/compliance-runs.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/documentation-impact-contract.md

# Policy Compliance Contract (Legacy Redirect)

This path remains available because older prompts, cached agent contexts, and
archived run artifacts may still point at it. It is not the primary policy source.

## Canonical routes

| Need | Load |
|---|---|
| Determine whether a compliance descriptor must run | `/lib/memory/handbook/compliance-runs.md` |
| Write or lint policy-shaped contract prose | `/lib/memory/handbook/contract-style.md` |
| Decide whether docs must be updated or a deferral is allowed | `/lib/memory/handbook/documentation-impact-contract.md` |
| Format operator-visible completion output | `/lib/memory/handbook/operator-output-contract.md` |
| Select global operating routes before any of the above | `/AGENTS.md` |

Agents SHALL cite and follow the canonical route that matches the task. If an
older prompt names only this file, treat it as an instruction to load `AGENTS.md`
and then the applicable canonical source above.
