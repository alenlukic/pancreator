# PRD index — when to read which section of `docs/PRD.md`

Read `docs/PRD.summary.md` first for orientation. For M1 or bootstrap routing, read
`docs/M1.index.md` before opening full `docs/BOOTSTRAP.md` or `docs/PRD.md`. Open `docs/PRD.md` at the listed
anchors only when the task matches the trigger. Line numbers refer to
`docs/PRD.md` in the repository as of the last manual refresh of this index; if
anchors drift, search the numbered heading in `docs/PRD.md`.

| Trigger | Open in `docs/PRD.md` |
|---------|------------------|
| Product thesis, goals, non-goals, target users | §1–§3 (starts line 67) |
| User stories US-1 through US-10 | §3.5 (starts line 109) |
| Glossary terms and core concepts | §4 (starts line 250) |
| System architecture and subsystems | §5 (starts line 292) |
| Framework versus library distribution (US-8) | §5.5 (starts line 384) |
| Persona roster and format | §6 (starts line 460) |
| Pipeline specs including `feature-delivery` | §7 (starts line 629) |
| Memory layout, Spec Kit paths, citations | §8 (starts line 908) |
| Human interface, inbox, CLI shape | §9 (starts line 1015) |
| Observability, control plane, run logs | §10 (starts line 1079) |
| MVP scope and package list | Prefer `docs/M1.index.md`; open §11 (starts line 1107) only for authoritative PRD wording |
| Milestones M0–M3 sequencing | Prefer `docs/M1.index.md`; open §12 (starts line 1135) only for authoritative PRD wording |
| Open questions Q1–Q22 and risks R-class | §13 (starts line 1152) |
| Success metrics | §14 (starts line 1210) |
| Research lineage appendix | §15 (starts line 1249) |

## Citation and spec work

When authoring or repairing **dual-anchor citations** into the PRD, agents
SHALL read the **exact** `docs/PRD.md` ranges they cite; this index is not a
citation source.

## Token-economy note

`docs/PRD.md` is explicit-read by default under `.cursorindexingignore`. Agents SHOULD
use this file, `docs/PRD.summary.md`, and `docs/M1.index.md` for routing before opening
full PRD ranges.
