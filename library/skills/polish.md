# Polish

Use when an operator asks to bring UI or design work into conformance — either
the UI and design changes already in the working tree, or a design task typed as
the command's prompt. The session holds no workflow run, no stage contract, and
no gate.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## Resolve scope

- An empty prompt selects the working tree's UI and design changes: diff
  against the merge base and keep every surface the diff touches.
- A non-empty prompt is the design task itself. Do that task under the
  same conformance rules.
- Either way, name the surfaces in scope before editing, and keep edits on the
  UI and design surface of the resolved scope.

## Resolve the design system by surface

- Operator briefs resolve to the project design system:
  `docs/operator-briefs/project.css` and `docs/operator-briefs/project.json`.
  `BRIEF-001` owns that surface: brief data describes content and semantic
  intent, and a project definition extends rather than overrides the shared
  primitives.
- Target UI resolves to the target's own tokens or style guide when it
  declares one.
- The heuristic checklist of `governance/handbooks/design/ux-guide.md` applies
  on every surface, with or without a design system. `DESIGN-001` on the
  active card references that handbook. Read it before judging a surface.

## Conform

1. Capture the surface, score it against the handbook heuristics and the
   resolved design system, fix the top issues, and re-capture — the
   capture-score-fix loop of `library/skills/visual-design-iteration.md`.
   `BROWSER-001` governs how captures are taken, so follow
   `library/skills/browser-inspection.md`.
   Iteration produces craft feedback, so the disclosed capture fallback that
   skill names is permitted.
2. Keep cross-surface consistency through the same loop: two surfaces that
   share a component or a token MUST NOT look decided by different rules.
3. When a design system owns the surface, enforce it: replace ad-hoc values
   with its tokens rather than adding near-duplicates.

## No design system

When a surface in scope has no design system:

1. Propose a minimal token set and name the file it would live in.
2. Ask the operator for approval with the question tool, and keep the approval
   on the session record.
3. Generate the file only after that recorded approval.
4. Without approval, proceed on the handbook heuristics alone and record that
   the surface has no design system.

## Edge cases

- An empty working-tree diff with an empty prompt ends the session: report
  that it found nothing to polish.
- A surface whose design system cannot be resolved follows the no-design-system
  path. Do not invent tokens silently.

## Outcome report

End the session with one fenced `markdown` block carrying:

- the resolved scope
- the design system resolved per surface, or the approval the session asked
  for
- the heuristics scored
- the changes made
- the before-and-after evidence paths
- any residual non-conformance.
