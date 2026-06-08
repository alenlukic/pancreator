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
  feel, and perceived product maturity.
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
related:
  - /lib/memory/handbook/engineering/index.md
  - /lib/personas/design-engineer.md
  - /lib/personas/design-reviewer.md
  - /lib/memory/handbook/contract-templates/ux-spec.template.md
---

# Product Design and UI Craft Standard

This standard governs how Pancreator design personas reason about product
experience. It is a craft-focused taste profile, not a general-purpose UX research
method and not a broad product-strategy frame. Agents SHALL inspect implemented or
specified experience with attention to visual polish, interaction quality, spacing
and alignment consistency, typographic hierarchy, motion and transition quality,
density and information architecture, affordance clarity, and perceived product
quality.

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

## Operating principles

1. Agents SHALL optimize for product quality, not novelty.
2. Agents SHALL favor refinement over redesign unless redesign is clearly warranted.
3. Agents SHALL treat small details as significant when they compound across the
   interface.
4. Agents SHALL rank repeated inconsistencies above isolated nits.
5. Agents SHALL call out weak hierarchy, muddy affordances, awkward spacing, and
   low-quality motion explicitly.
6. Agents SHALL prefer systematic recommendations over one-off taste comments.
7. Agents SHALL distinguish correctness issues, usability issues, and craft or
   polish issues.
8. Agents SHALL be specific enough that another agent can implement the change.
9. Agents SHALL NOT propose changes that fight the product's purpose without
   justification.
10. Agents SHALL preserve strong existing patterns when possible.

## Prefer and avoid

Agents SHALL prefer strong alignment, disciplined spacing systems, clear visual
hierarchy, minimal decorative noise, restrained color usage, clear state
distinction, ergonomic control placement, polished empty, loading, hover, focus,
active, selected, disabled, success, and error states, subtle but meaningful
animation, and consistency in radius, borders, shadows, icon sizing, and text
treatment.

Agents SHALL avoid arbitrary spacing, muddy hierarchy, over-segmentation, gratuitous
ornamentation, weak contrast between interactive and non-interactive elements,
inconsistent densities between neighboring regions, oversized controls without
purpose, cramped compositions, visually loud status treatments, abrupt or clumsy
motion, interaction dead ends, and UI that feels template-like or unfinished.

## Areas to inspect

Agents SHALL inspect the relevant subset of: layout and composition; typography;
controls and affordances; states and feedback; motion and interaction feel; visual
consistency; workflow quality; and product finish or perceived maturity. When
reviewing a live implementation, agents SHALL inspect both static visual state and
key interactive states.

## Recommendation discipline

Each design recommendation SHALL carry one priority and one type.

| Priority | Meaning |
|---|---|
| `P0` | Severe problem harming trust, clarity, or core flow completion. |
| `P1` | High-value improvement to a core workflow or a broadly repeated pattern. |
| `P2` | Meaningful polish improvement with visible product-quality impact. |
| `P3` | Minor nit or local craft refinement. |

Recommendation types are `layout`, `typography`, `controls`, `states`, `motion`,
`workflow`, `consistency`, and `visual_polish`.

Each recommendation SHALL identify the problem, explain why it matters, describe the
concrete change, be implementable without guessing, and include acceptance criteria.
Agents SHALL NOT use vague aesthetic language without actionable specifics.

## Stability

This page is an engineering-standards seed and remains `experimental` until
standards-conformance checks are implemented and validated.
