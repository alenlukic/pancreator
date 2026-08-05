# Craft an operator artifact

Use when producing a narrative artifact for an operator: a specification, plan, implementation summary, review, QA report, release packet, investigation, or other decision surface.

## Standard

Under `BRIEF-001`, use the operator brief system for new operator-facing narrative artifacts:

1. Author schema-valid JSON using `library/schemas/operator-brief.schema.json`.
2. Use shared semantics from `library/operator-briefs/primitives.json` and project semantics from `docs/operator-briefs/project.json`.
3. Render self-contained HTML with `./bin/pan briefs render --input <brief.json> --output <brief.html>`.

For workflow stages, use the exact source and rendered paths declared in
`output.operator_brief`; list HTML as artifact 0 and brief JSON as artifact 1.
The harness rerenders the source during submission so the displayed document is
always derived from the validated content contract.

Existing historical Markdown does not require migration. Canonical
invocation/delegation records, machine workflow records, source documentation,
PR copy, and other formats that are themselves part of an execution contract
remain exceptions. New workflow-stage narratives are not an exception.

## Language

Under `STE-001`, write the artifact in Simplified Technical English, adapted from
ASD-STE100 Issue 9. The active invocation references the complete guidance. The
rules that shape most artifacts are these:

- Use a maximum of 20 words in an instruction and 25 words in explanation. An identifier, a path, a command, an inline code span, quoted text, and a hyphenated word each count as one word.
- Keep a paragraph to one topic and six sentences or fewer.
- Write instructions in the imperative form and the active voice.
- Use one term for one concept, and prefer the term the repository already uses.
- Do not use a semicolon, a contraction, a Latin abbreviation, a perfect or progressive tense, or an `-ing` form outside a domain term.
- Preserve quoted evidence and captured output verbatim. Never rewrite evidence to satisfy a writing rule.

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
