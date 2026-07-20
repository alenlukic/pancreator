# HTML prototype

Use when producing authoritative interactive mocks for a design stage.

## Principle

Prototypes are single-file, self-contained HTML documents. Tokens come first.
Semantic landmarks make section capture and accessibility passes possible.

## Steps

1. Define CSS custom properties for color, type, and spacing before any screen
   markup.
2. Build one file per key screen or a clearly sectioned multi-screen file under the
   run’s `artifacts/mocks/`.
3. Use landmarks: `header`, `nav`, `main`, `section`, `footer`, with meaningful
   headings inside sections.
4. Annotate or implement interaction states (hover/focus/disabled where relevant)
   and empty/loading/error/success content.
5. Avoid external dependencies, CDNs, and build steps.
6. For key screens, produce more than one variant before converging.

## Boundaries

HTML prototypes are the authoritative mock medium for the design workflow.
