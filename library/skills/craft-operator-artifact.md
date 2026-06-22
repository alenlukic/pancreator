# Craft an operator artifact

Use when writing the markdown deliverable a stage produces (the spec, plan,
implementation summary, review, QA report, or release packet).

## Principle

The artifact is for a human operator scanning fast. Markdown is primary;
structured data is embedded only where it adds precision. Lead with the answer,
then the support, then the machine detail.

## Structure

1. Title and a one-line outcome.
2. A short operator summary: outcome, blockers, evidence pointers, next action.
3. Body with clear headings and an intuitive hierarchy; short paragraphs and
   lists over walls of text.
4. A technical appendix at the end for embedded structured blocks (fenced JSON)
   and raw metadata.

## Use emojis as signal, not decoration

A small, consistent set carries status at a glance: white check mark for pass,
cross mark for fail, pause button for blocked, warning sign for risk, magnifying
glass for evidence, rocket for ready-to-ship. One per line at most; never
sprinkle them for tone.

## Quality bar

- An operator can grasp the outcome and next action from the first screen.
- Headings tell the story even if the prose is skipped.
- Raw logs and large JSON live in the appendix or linked evidence files, never
  in the lead.
