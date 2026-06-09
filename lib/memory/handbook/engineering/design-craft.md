---
title: Product Design and UI Craft Standard
slug: engineering-design-craft
stability: experimental
bootstrap-only: false
phase: 0b
owners: [design-engineer, design-reviewer]
purpose: |
  The product design and UI craft taste profile that `design-engineer` applies when
  authoring UX specs and `design-reviewer` applies when running design QA. Agents
  SHALL optimize for clarity, cohesion, usability, aesthetic quality, interaction
  feel, and perceived product maturity, and SHALL enforce the measurable craft
  standards and gate-blocking conditions defined on this page.
references:
  - kind: lines
    path: lib/memory/handbook/engineering/index.md
    range: [1, 1]
    contentHash: c50e6bf
    note: "Engineering standards index routes design activities to this page."
  - kind: lines
    path: lib/memory/handbook/contract-templates/ux-spec.template.md
    range: [28, 48]
    contentHash: e285662
    note: "UX-spec template slot map for machine-checkable design assertions."
external:
  - https://lawsofux.com/
  - https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/
  - https://mobbin.com/
  - https://www.w3.org/WAI/standards-guidelines/wcag/
related:
  - /lib/memory/handbook/engineering/index.md
  - /lib/personas/design-engineer.md
  - /lib/personas/design-reviewer.md
  - /lib/memory/handbook/contract-templates/ux-spec.template.md
---

# Product Design and UI Craft Standard

This standard governs how Pancreator design personas reason about product
experience. It is a craft-focused taste profile and an enforceable rule set, not a
general-purpose UX research method and not a broad product-strategy frame. Agents
SHALL inspect implemented or specified experience with attention to visual polish,
interaction quality, spacing and alignment consistency, typographic hierarchy,
motion and transition quality, density and information architecture, affordance
clarity, and perceived product quality. This page defines three escalating layers:
the **taste profile** (intent), the **measurable craft standards** (objective
thresholds), and the **gate-blocking conditions** (what fails design QA).

## Taste profile

Agents SHALL lean toward the product disciplines embodied in tools such as Linear,
Instagram, and Spotify. Agents SHALL NOT copy those products' visual styling
literally; agents SHALL optimize for restraint, coherence, hierarchy, smoothness,
high signal density without clutter, premium interaction feel, strong defaults, and
consistency across repeated patterns. Agents SHALL be intentionally fastidious and
SHALL call out small issues that materially affect perceived quality.

Interfaces SHALL feel crisp, intentional, calm, dense but breathable, visually
ordered, tactile without being flashy, fast and predictable, and premium in small
interactions.

## Principle base

Agents SHALL ground every recommendation in at least one named principle below.
Vague taste assertions without a principle and a measurable target are forbidden.

### Laws of UX (cited from `https://lawsofux.com/`)

| Law | Obligation for Pancreator surfaces |
|---|---|
| Aesthetic-Usability Effect | The surface SHALL look intentionally designed; unaligned, off-scale, or unfinished composition erodes perceived trust and is a craft defect. |
| Hick's Law / Choice Overload | Each region SHALL expose the minimum set of actions for its job; agents SHALL collapse, group, or defer secondary actions rather than show every action at once. |
| Miller's Law / Chunking | A region SHALL group related items into labelled chunks; flat lists longer than 7 peer items SHALL be grouped, paginated, or scrolled inside a bounded container. |
| Law of Proximity / Common Region | Related controls and their data SHALL sit in one bounded region with shared spacing; unrelated regions SHALL be separated by larger gaps or borders. |
| Jakob's Law | Patterns SHALL match the conventions of mature tools (Linear, Spotify, Instagram, GitHub) unless a deviation is justified in the spec. |
| Fitts's Law | Primary actions SHALL use large, reachable hit targets at least 32px in the smaller dimension; destructive actions SHALL NOT sit adjacent to frequent safe actions without separation. |
| Von Restorff Effect | Exactly one primary action per region SHALL carry the accent treatment; secondary actions SHALL use lower-emphasis styling. |
| Serial Position Effect | The most important item SHALL appear first or last in a series, not buried in the middle. |
| Doherty Threshold | Interactive feedback SHALL appear within 400ms; any operation that may exceed 400ms SHALL show a loading or progress state. |
| Tesler's Law | Irreducible complexity SHALL be absorbed by the system through strong defaults, not pushed onto the operator as raw configuration. |
| Peak-End Rule | Completion, success, and error moments SHALL receive deliberate polish because operators judge the experience by these peaks. |

### Fundamental UX principles (cited from `https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/`)

Agents SHALL apply the seven fundamentals: **user-centricity** (design for the
human operator's real task, not for internal data shapes), **consistency** (identical
patterns behave and look identical), **hierarchy** (information architecture and
visual hierarchy make the most important content first-read), **context** (respect
the operator's device, urgency, and viewport), **user control** (provide
undo, cancel, and clearly marked exits), **accessibility** (WCAG 2.2 AA minimum),
and **usability** (learnability, efficiency, memorability, error recovery, and
satisfaction). Usability SHALL take precedence over decoration.

### Real-world pattern fidelity (cited from `https://mobbin.com/`)

Agents SHALL specify and verify the standard states of each pattern as shipped by
mature products: list rows, headers, empty states, loading skeletons, paywalls,
settings, search, and confirmation flows. When a surface implements a known pattern,
its empty, loading, populated, hover, selected, and error states SHALL all be
specified and present, not just the populated state.

## Measurable craft standards

Agents SHALL hold every reviewed or specified surface to the objective thresholds
below. A surface that violates a threshold without a documented, justified waiver is
a defect, not a matter of taste.

### Spacing and layout

1. Spacing SHALL derive from a single base unit (4px) scale; arbitrary one-off
   pixel values are forbidden when a scale token fits.
2. Every element SHALL render inside its parent container's bounds. Borders,
   backgrounds, and text SHALL NOT overflow, clip, or bleed past the container edge
   at any supported breakpoint.
3. Aligned elements SHALL share an edge or baseline; neighboring regions SHALL NOT
   drift by sub-grid amounts.
4. Neighboring regions of the same kind SHALL share one density; padding SHALL NOT
   vary between sibling cards or rows without reason.

### Typography

1. Type SHALL use a bounded scale of named sizes and weights; a single screen SHALL
   NOT introduce more than roughly 5 distinct sizes.
2. Hierarchy SHALL be expressed through the scale, weight, and color, not through
   arbitrary sizes; body, label, and caption roles SHALL be distinguishable.
3. Line length for reading text SHALL stay within roughly 45–90 characters.

### Information hierarchy and operator readability

1. Each region SHALL have one clear first-read element; the primary action or
   primary datum SHALL be visually dominant.
2. Content SHALL be written for the human operator, not copied from internal data
   shapes. Raw absolute paths, raw repo-relative paths, raw IDs, and raw timestamps
   SHALL NOT be the primary displayed content and SHALL NOT appear as readable text
   in the default view of orientation panels (Active memory, inbox triage, Next
   Action, and peer sidebar or command-center regions). The surface SHALL show a
   human-readable label and MAY expose the raw value only through a copy-only
   control or a details disclosure that is **closed by default** (never a visible
   monospace path row beside the label).
3. Verbose internal prose (for example full `current.md` blocker dumps, spec
   excerpts, or config blobs) SHALL NOT render as body copy; the surface SHALL
   summarize into operator-facing labels, counts, or chip rows.
4. Long values SHALL truncate with an accessible full-value affordance rather than
   overflow their container or wrap unboundedly.
5. Verbose prose SHALL be compacted: a primary label SHALL stay at most roughly 60
   characters, and a region SHALL summarize rather than dump full source text.

### Controls, affordances, and action labeling

1. A call to action SHALL name an imperative verb plus a concrete object
   (for example "Refresh active memory", "Copy run command", "Open OPERATION.md",
   "Open in Files"). Bare or ambiguous labels are forbidden, including
   "Refresh procedure", "Open refresh procedure", "Submit", "OK", "Click here",
   "Go", and labels that name an abstract noun ("procedure", "docs", "help")
   without a concrete target file, module, or object.
2. Interactive and non-interactive elements SHALL be visually distinct.
3. Exactly one primary action per region SHALL carry accent emphasis.
4. Disabled and unavailable actions SHALL look disabled and SHALL explain why when
   the reason is not obvious.

### States and feedback

1. Every surface that owns them SHALL specify and render empty, loading, hover,
   focus, active, selected, disabled, success, and error states.
2. Loading states SHALL appear within 400ms of an action per the Doherty Threshold.
3. Empty states SHALL guide the operator to the next action with one suggested step
   or link, not show hollow dead space or a single muted sentence alone.
4. Orientation and list-row panels SHALL use solid elevated surfaces (card or inset
   region), not dashed or placeholder borders in the default shipped state.

### Color, contrast, and accessibility

1. Text SHALL meet WCAG 2.2 AA contrast of at least 4.5:1 (3:1 for large text).
2. Non-text UI (focus rings, borders, control boundaries) SHALL meet at least 3:1.
3. Accent color SHALL be reserved for primary actions and active states, not
   sprayed across the surface.
4. All interactive controls SHALL show a visible focus indicator and SHALL be fully
   keyboard operable.

### Consistency and motion

1. A repeated pattern SHALL use identical tokens for radius, border, shadow, icon
   sizing, and text treatment across every instance.
2. Motion SHALL be subtle and purposeful; transitions SHALL stay within roughly
   120–240ms and SHALL honor `prefers-reduced-motion`.

## Recommendation discipline

Each design recommendation SHALL carry exactly one priority and exactly one type.

| Priority | Meaning | Gate effect |
|---|---|---|
| `P0` | Severe problem harming trust, clarity, or core flow completion. | Blocks: forces `design_qa_passes: false`. |
| `P1` | High-value fix to a core workflow or a broadly repeated pattern. | Blocks: forces `design_qa_passes: false`. |
| `P2` | Meaningful polish improvement with visible product-quality impact. | Non-blocking; logged for follow-up. |
| `P3` | Minor nit or local craft refinement. | Non-blocking; logged for follow-up. |

Recommendation types are `layout`, `typography`, `controls`, `states`, `motion`,
`workflow`, `consistency`, and `visual_polish`.

Each recommendation SHALL identify the problem, cite the violated principle or
measurable standard, explain why it matters, describe the concrete change, be
implementable without guessing, and include acceptance criteria. Agents SHALL NOT
use vague aesthetic language without actionable specifics.

## Gate-blocking conditions

This section answers, unambiguously, which design issues block the pipeline. The
`design-reviewer` SHALL set `design_qa_passes: false` when any condition below holds
on a surface in scope. Each blocking finding SHALL be recorded as a `P0` or `P1`
recommendation with its violated standard cited.

1. **Containment failure (P0).** Any element overflows, clips, or bleeds past its
   container at a supported breakpoint.
2. **Raw-data exposure (P1).** A raw repo-relative path, raw ID, or raw ISO
   timestamp appears as readable text in the default view of an orientation panel,
   list row, or command-center region — including a demoted monospace row — with no
   closed-by-default disclosure. Copy-only affordances that do not render the path
   as visible text are permitted.
3. **Ambiguous or non-actionable CTA (P1).** A primary or accent control uses a
   banned vague label (including "Refresh procedure" and "Open refresh procedure")
   or names an abstract noun without a concrete target file, module, or object.
4. **Off-system spacing or alignment (P1).** Spacing ignores the base scale, or
   aligned elements drift, such that the composition reads as unfinished across the
   region.
5. **Broken information hierarchy (P1).** A region has no clear first-read element,
   the most important content is not visually dominant, or sidebar and main-column
   regions compete at equal visual weight without a declared primary column.
6. **Missing required state (P1).** A surface that owns empty, loading, or error
   states ships without one, shows hollow space, or shows an empty state with no
   guided next action.
7. **Accessibility floor breach (P0).** Text contrast falls below 4.5:1, non-text
   contrast below 3:1, a control lacks a visible focus indicator, or a flow is not
   keyboard operable.
8. **Feedback-latency breach (P1).** An operation that may exceed 400ms shows no
   loading or progress state.
9. **Unfinished or wireframe composition (P1).** A shipped panel uses dashed
   borders, placeholder chrome, or flat undifferentiated blocks such that the
   surface reads as a scaffold rather than an intentionally designed product
   (Aesthetic-Usability Effect).
10. **Choice overload in a list row (P1).** A single inbox or orientation row shows
    three or more peer action buttons at equal emphasis without overflow or a single
    primary plus menu pattern (Hick's Law).
11. **Internal prose dump (P1).** Blockers, config, or memory content renders as
    multi-sentence source prose instead of a summarized operator label, count, or
    structured excerpt (Tesler's Law / operator readability).
12. **Accent sprawl (P1).** A single panel or region shows two or more accent-filled
    primary buttons, or accent treatment on both a module tab and multiple in-panel
    CTAs, violating one-primary-per-region (Von Restorff Effect).

Every `P0` and `P1` finding SHALL force `design_qa_passes: false`. `P2` and `P3`
findings SHALL NOT block the gate but SHALL be logged in the report for operator
follow-up. The `design-reviewer` SHALL NOT set `design_qa_passes: true` while any
`P0` or `P1` finding stands, and SHALL NOT downgrade a gate-blocking condition to
`P2` or `P3` to avoid failing the gate. A deferrable `P1` build defect MAY carry
`spot_fixable: true` to route the fix through the lighter implement spot-fix lane;
that flag keeps `design_qa_passes: false` until the defect is fixed and does not pass
the gate.

## Stability

This page is an engineering-standards seed and remains `experimental` until
standards-conformance checks are implemented and validated.
