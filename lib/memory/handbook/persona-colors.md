---
title: Persona Color Palette
slug: persona-colors
stability: experimental
bootstrap-only: false
phase: 0b
owners: [persona-designer, librarian]
purpose: |
  The canonical UX-color palette for the persona `color` field. Resolves the
  dangling pointer in `lib/personas/skills/author-persona/SKILL.md` Step 3 and projects
  the palette table from `/lib/memory/handbook/persona-spec.md` §6 into a
  dedicated handbook file so future personas have a stable lookup target.
references:
  - kind: lines
    path: /lib/memory/handbook/persona-spec.md
    range: [180, 210]
    contentHash: 2c98017
    note: "Persona Spec Format §6 — palette table; this file is the canonical alias."
related:
  - /lib/memory/handbook/persona-spec.md
  - /lib/memory/handbook/glossary.md
---

# Persona Color Palette

The `color` field on every persona is a UX hint shown in pipeline timelines,
inbox threads, and ensemble transcripts. The palette below is the canonical
allocation. Pick the next unused color when authoring a new persona; reserve
`red` for `ombudsperson`-class personas to preserve operator legibility.

## Palette table

| Color | Reserved for | Status |
|---|---|---|
| `violet` | `persona-designer` | used |
| `amber` | `contract-writer` | used |
| `slate` | `tech-writer` | used |
| `blue` | review-class personas (`reviewer`, `appsec`) | guideline |
| `green` | implementation-class personas (`coder`, `frontend-eng`) | guideline |
| `cyan` | planning-class personas (`tech-lead`, `intake-analyst`) | guideline |
| `purple` | `pm`, `groomer`, `supervisor` | guideline |
| `teal` | `librarian`-class | guideline |
| `orange` | scout-class | guideline |
| `red` | `ombudsperson`, watchdog | reserved |

> **Accessibility backlog item.** This palette has not yet been validated against
> the eight common forms of color-vision deficiency (deuteranopia, protanopia,
> tritanopia, achromatopsia, plus their anomalous variants). A future PRD revision
> SHALL adopt a colorblind-safe palette (e.g., the Okabe–Ito 8-color set or
> ColorBrewer "qualitative" ramps) and any UI surface that renders persona color
> SHALL pair the swatch with an icon or short label so personas remain
> distinguishable without color discrimination. Tracked under the M5+ docs queue.

## How to extend

When the palette runs out, append a row above this section. Do not improvise
a color outside the documented palette; the runtime UI surfaces SHALL render
unknown colors as `slate` and emit a Layer 1 warning during `pan persona
validate`.

When two personas need the same color (e.g., a long-lived SME family),
namespace the color in the persona file via `metadata.pancreator-color-suffix`
(e.g., `cyan-100`, `cyan-200`). The base color then matches at the runtime
filter level.

## Stability

This file is the Phase 0b handbook seed. The palette table mirrors the inline
table in `/lib/memory/handbook/persona-spec.md` §6 verbatim. Source of truth is
this file from M1 onward; persona-spec.md §6 SHALL link to this file when its
next revision lands.
