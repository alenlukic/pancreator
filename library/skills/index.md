# Skills

Focused, reusable techniques a worker applies inside a stage. A skill is
narrower than a persona and broader than a single prompt: it is the "how" for a
recurring job. Read the skill relevant to your current step.

## Cross-cutting

- [`write-stage-output.md`](write-stage-output.md) - produce the declared JSON
  output correctly.
- [`craft-operator-artifact.md`](craft-operator-artifact.md) - write the
  structured brief data and semantic HTML an operator reads.
- [`evaluate-evidence.md`](evaluate-evidence.md) - judge whether evidence
  supports a criterion.
- [`scope-control.md`](scope-control.md) - keep a change minimal and bounded.
- [`prompt-augmentation.md`](prompt-augmentation.md) - augment an operator
  prompt for one-shot execution.
- [`spotfix.md`](spotfix.md) - execute or escalate one operator-selected lightweight change.
- [`shepherd-pr.md`](shepherd-pr.md) - watch one GitHub PR for review feedback,
  judge it, implement what survives, and gate each push through the review
  squad.
- [`browser-inspection.md`](browser-inspection.md) - observe a running web UI in an
  isolated browser context.
- [`supervisor-recovery.md`](supervisor-recovery.md) - reconcile state and avoid
  duplicate workers after a supervisor interruption.

## Stage-aligned

- [`map-acceptance-criteria.md`](map-acceptance-criteria.md) - planning.
- [`modern-code-review.md`](modern-code-review.md) - independent review.
- [`review-squad.md`](review-squad.md) - shepherd review by one agent per
  review dimension, coordinated under `SHEPHERD-001`.
- [`update-release-metadata.md`](update-release-metadata.md) - release metadata
  and version-bearing documentation.
- [`manual-qa-cases.md`](manual-qa-cases.md) - quality assurance.
- [`release-packet.md`](release-packet.md) - release preparation.
- [`write-pr-description.md`](write-pr-description.md) - draft a merge-ready PR
  body from a workflow run or a standalone base-to-worktree comparison.

## Pancreator self-development only

These skills ship only in a Pancreator source checkout. `bin/install` drops them
from the staged payload, so a target installation does not carry them. They are
listed without links for that reason.

- `review-squad-pancreator.md` - the harness review lineup that replaces the
  core squad dimensions when the review target is Pancreator itself.

## Design

- [`design-spec.md`](design-spec.md) - author a UI/UX design specification.
- [`html-prototype.md`](html-prototype.md) - build token-first self-contained HTML
  prototypes.
- [`design-critique.md`](design-critique.md) - heuristic critique of specs and mocks.
- [`visual-design-iteration.md`](visual-design-iteration.md) - screenshot-score-fix
  visual iteration loop.
