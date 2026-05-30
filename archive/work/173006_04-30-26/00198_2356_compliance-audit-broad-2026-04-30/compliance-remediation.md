# Compliance Remediation Summary — Broad Sweep 2026-04-30

**Audit:** `archive/work/173006_04-30-26/00198_2356_compliance-audit-broad-2026-04-30/compliance-audit.md`
**Gate:** `compliance_passes: false`
**Invocation mode:** `non_interactive`

---

## Files changed by auto-remediation

None. Zero auto-remediations were applied in this invocation. All findings require human ratification or named-owner action before edits can proceed.

---

## Unresolved findings checklist

### Block findings
- [ ] None.

### Major findings
- [ ] **MA-001** `lib/personas/contract-writer.md` — description field lacks RFC 2119 obligation keyword. Requires human ratification (self-protected meta-persona) then `persona-designer` edit. Suggested rewrite example: "When a human requests a machine-checkable gate clause, the `contract-writer` SHALL author the clause to the PRD §4.5 wrapper schema and §4.6 5-layer style discipline and register it in the feature's `contracts.index.json`."
- [ ] **MA-002** `lib/personas/persona-designer.md` — description field lacks RFC 2119 obligation keyword. Requires human ratification (self-protected meta-persona) then `persona-designer` edit. Suggested rewrite example: "When a human invokes the persona-designer during bootstrap Phase 1 or when the Librarian proposes a new SME (M4+), the `persona-designer` SHALL author a conforming Pancreator subagent persona specification to the Anthropic Claude Agent SDK 16-field YAML frontmatter spec and emit matching Cursor `.mdc` shims."
- [ ] **MA-003** `lib/personas/supervisor.md` — `color: magenta` is not in the closed palette defined in `lib/memory/handbook/persona-spec.md` §6. Owner: `persona-designer`. Suggested fix: change to `color: purple` (pending human approval; update `.cursor/agents/supervisor.md` mirror in the same change).

### Minor findings
- [ ] **MI-001** `lib/personas/compliance-auditor.md` — `color: red` misappropriates the reserved ombudsperson color. Bundle with `bootstrap-colorblind-safe-palette-migration` (backlog id: `bootstrap-colorblind-safe-palette-migration`, owner: `persona-designer`).
- [ ] **MI-002** `lib/personas/coder.md` + `lib/personas/pancreator-engineer.md` — both use `color: green`, creating a palette collision. Bundle with `bootstrap-colorblind-safe-palette-migration`.
- [ ] **MI-003** `lib/personas/tech-lead.md` — metadata key `pancreator-color-suffix: cyan-200` is unrecognized per `lib/memory/handbook/persona-spec.md` §7. Remove or open RFC. Owner: `persona-designer`.
- [ ] **MI-004** `lib/inbox/in/timestamp_naming_conventions.md` — file lacks required `{SID}_{HHMM}_` timestamp prefix per ADR-0005. Owner: `intake-analyst` / `pancreator-engineer`. Action: rename file and update all references per ADR-0005 migration procedure.

---

## Next-owner routing

| finding | owner | action required |
|---|---|---|
| MA-001 | Human → persona-designer | Human ratifies prose rewrite; persona-designer applies and runs audit to verify. |
| MA-002 | Human → persona-designer | Human ratifies prose rewrite; persona-designer applies and runs audit to verify. |
| MA-003 | persona-designer | Propose conforming color, get human approval, apply to persona and `.cursor/agents/` mirror. |
| MI-001 | persona-designer | Batch with `bootstrap-colorblind-safe-palette-migration`. |
| MI-002 | persona-designer | Batch with `bootstrap-colorblind-safe-palette-migration`. |
| MI-003 | persona-designer | Next persona maintenance pass: remove `pancreator-color-suffix` key or open RFC. |
| MI-004 | intake-analyst / pancreator-engineer | Rename `lib/inbox/in/timestamp_naming_conventions.md` with SID/HHMM prefix; run reference-update pass per ADR-0005. |
| PA-001 | Human (approve/reject) → persona-designer (implement) | Review proposal in `compliance-audit.md` §6; approve or reject; if approved, persona-designer implements. |
| PA-002 | Human (approve/reject) → persona-designer + coder | Review proposal in `compliance-audit.md` §6; approve or reject; if approved, scope to Phase 3 automation work. |

---

## Rerun conditions

The next compliance broad-sweep run SHOULD proceed after:

1. Human ratifies MA-001 and MA-002 prose rewrites (unblocks self-protected meta-persona edits).
2. `persona-designer` resolves MA-003 (supervisor color) and MI-003 (unrecognized key).
3. `intake-analyst` or `pancreator-engineer` resolves MI-004 (inbox filename rename).

The next run is expected to produce `compliance_passes: true` with at most minor/note findings remaining in the MI-001/MI-002 palette-migration batch (pending `bootstrap-colorblind-safe-palette-migration`).
