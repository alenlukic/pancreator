# Operator brief system

Pancreator uses one compositional model for operator-facing narrative artifacts while allowing each installation to add domain-specific semantics and visual identity.

## Model

The content contract is JSON; the operator artifact is self-contained semantic HTML; presentation belongs to CSS and registries.

- A **field** is a labeled property on a card. Its `placement` (`meta`, `body`, or `footer`) expresses information role without encoding layout.
- A **card** is one operator-scannable unit. Its registered type supplies a default layout and may require particular field semantics.
- A **section** groups related cards and names a registered semantic intent. The renderer resolves its emoji from the registry, keeping one meaning per emoji within the repository.
- A **brief** groups related sections and declares a registered brief type. Its first section is always `executive-summary`.

This separation lets the same data support layout changes, dark mode, printing, accessibility, and project theming without rewriting artifact content.

## Bottom line first

The executive summary is the first section and first screen. It should answer, in this order where applicable:

1. What matters or changed?
2. Why does it matter?
3. What outcome was reached?
4. What action or decision is required?

Do not turn the executive summary into a table of contents. It is the actual conclusion.

## Semantic registries

Pancreator-owned definitions live in `library/operator-briefs/primitives.json`. They cover reusable workflow, action, validation, risk, release, and evidence concepts.

Project extensions live in `docs/operator-briefs/project.json`. They may add brief types, section semantics, card types, and field semantics, but may not override shared keys. Section emoji are registry data, not author-selected decoration. A repository must not assign one emoji to multiple section meanings.

Use the smallest stable ontology that reflects recurring operator decisions. Do not register one-off subjects, names, dates, or statuses as types.

## Design system

`library/operator-briefs/base.css` supplies the shared accessible layout and behavior. `docs/operator-briefs/project.css` supplies project tokens and bounded component refinements.

Design rules:

- Prefer whitespace, grouping, and hierarchy over borders and visual furniture.
- Keep sections shallow: brief → section → card → field/item. Do not nest sections or cards.
- Keep headings concise and let them carry the narrative when prose is skipped.
- Use `split-header` cards when logistical metadata belongs apart from substantive content.
- Use alternating item/card backgrounds only to distinguish repeated enumerated content.
- Encode status and urgency semantically; color must reinforce, not replace, labels.
- Put an explicit action on the card when the operator can do something next.
- Keep evidence and raw logs linked or summarized rather than pasted into the lead.

## Lifecycle

Scaffold or regenerate the project layer:

```sh
./bin/pan briefs build
./bin/pan briefs build --force
./bin/pan briefs validate
```

In an embedded installation, use `./.pancreator/bin/pan`. `/pan-build-briefs` inventories the target repository and asks the librarian to refine the generated registry and project CSS around recurring operator-facing use cases.

Render an artifact from data:

```sh
./bin/pan briefs render \
  --input path/to/brief.json \
  --output path/to/brief.html
```

The renderer validates all semantic references, requires the executive summary first, rejects active HTML content, embeds the common and project CSS, and writes a portable HTML file with no runtime dependency.

Fresh embedded installations receive the shared system but no target ontology. Target files are generated after installation and are preserved across refreshes. Legacy installations can run the same build command; existing Markdown artifacts are left untouched.

## Authoring and safety

Prefer plain text for card bodies. `body_html` is available for bounded semantic markup when plain text is insufficient, but scripts, event handlers, forms, embedded documents, and unsafe URL schemes are rejected. Artifact producers should treat external content as data and escape it rather than passing it through as HTML.
