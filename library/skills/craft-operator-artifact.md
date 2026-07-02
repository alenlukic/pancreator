# Craft an operator artifact

Use when producing a narrative artifact for an operator: a specification, plan, implementation summary, review, QA report, release packet, investigation, or other decision surface.

## Standard

Under `BRIEF-001`, use the operator brief system for new operator-facing narrative artifacts:

1. Author schema-valid JSON using `library/schemas/operator-brief.schema.json`.
2. Use shared semantics from `library/operator-briefs/primitives.json` and project semantics from `docs/operator-briefs/project.json`.
3. Render self-contained HTML with `./bin/pan briefs render --input <brief.json> --output <brief.html>`.

Existing Markdown does not require migration. Canonical invocation/delegation records, machine workflow records, source documentation, and other formats that are part of an execution contract remain exceptions.

## Composition

- Begin with `executive-summary`; state the bottom line, why it matters, the outcome, and the next action when applicable.
- Use sections for distinct operator questions, not for every paragraph.
- Use one card per independently scannable subject or decision.
- Use fields for labeled facts. Mark logistical or identity data as `placement: "meta"` so it is visually separate from substantive detail.
- Add a primary action when the operator has a concrete next step.
- Put raw evidence in linked artifacts or a bounded evidence card, not in the executive summary.

## Semantics and presentation

Authors choose semantic keys, not emojis or colors. The registry gives section semantics a stable emoji, and CSS maps status/urgency tones to visual treatment. Do not add inline styles, layout markup, or ad hoc emoji prefixes to brief data.

Use `body_html` only for bounded semantic markup that plain text cannot express. Never pass through untrusted HTML. The renderer rejects scripts, event handlers, forms, embedded documents, and unsafe URL schemes.

## Quality bar

- The first screen gives the operator the conclusion and action state.
- Headings tell the story when body text is skipped.
- Data and metadata are visually distinct.
- The structure is no deeper than brief → section → card → field/item.
- Repeated content is easy to compare without becoming a wall of boxes.
- The artifact remains readable in light mode, dark mode, narrow viewports, and print.
